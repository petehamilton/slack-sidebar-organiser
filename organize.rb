require 'optparse'
require 'pp'
require 'uri'
require "json"
require 'zlib'
require 'stringio'
require "ruby-progressbar"
require 'set'
require "limiter"
require "./lib"

sample_curl_request = File.read(ARGV[0])
sidebar_rules_raw = ARGV[1] ? JSON.parse(File.read(ARGV[1])) : {}

# Vomit. I promise I'm an engineer.
write_changes = ARGV[2] == "--write"

# Parse the sample cURL command and extract the auth token.
# I'm sure there's a way to do this without the gsub fuckery,
# but I'm doing this quickly for fun. Code shame me later.
parsed_curl_command = parse_curl_command(sample_curl_request)
parsed_body = parsed_curl_command[:data]
  .gsub('\n', "\n")
  .gsub('\r', "\r")

base_uri = parsed_curl_command[:uri]
cookie = parsed_curl_command[:headers]["cookie"]
token = token_from_body(parsed_body)
if token.nil?
  puts "Unable to extract token from sample cURL request, bailing"
  exit
end

client = SlackClient.new(base_uri: base_uri, cookie: cookie, token: token)

puts
puts "LOADING SIDEBAR SECTIONS"
puts "========================="

# Load sidebar sections via API
sidebar_sections = client
  .get_sidebar_list()
  .dig("channel_sections")
  .select { |s| s["type"] == "standard" }
  .map { |s| SidebarSection.from_json(s) }

get_sidebar_section = ->(id) { sidebar_sections.find { |s| s.id == id } }

# Print out sidebar sections
sidebar_sections.sort_by(&:name).each do |s|
  puts "#{s.id}: #{s.name} (#{s.channel_ids.size})"
end

sidebar_rules = []
if sidebar_rules_raw.any?
  puts
  puts "LOADING RULES"
  puts "============="

  sidebar_rules = sidebar_rules_raw.map do |json|
    # Look up sidebar section by ID first
    sidebar_section =
      sidebar_sections.find { |s| json["sidebar_section"] == s.id } ||
      sidebar_sections.find { |s| json["sidebar_section"] == s.name } ||

    if !sidebar_section
      puts "Couldn't find sidebar section for #{json["sidebar_section"]}"
      exit
    end

    SidebarRule.from_json(sidebar_section.id, json)
  end

  max_rule_length = sidebar_rules.map(&:to_s).map(&:size).max
  sidebar_rules.each do |rule|
    sidebar = get_sidebar_section.call(rule.sidebar_section_id)

    puts "#{rule.to_s.rjust(max_rule_length+3)} ➜ #{sidebar.name} (#{rule.sidebar_section_id})"
  end
end

puts
puts "LOADING CHANNELS"
puts "================"

all_channels = client.get_channels(cursor: nil, fetched: -> { print "." })

# Filter to real channels only, no DMs etc
all_channels.select! { |c| c["is_channel"]}

# Filter to channels user is a part of, turn into ID => Channel mapping
channels = all_channels.select { |c| c["is_member"]}.group_by { |c| c["id"] }.map { |k, v| [k, v.first] }.to_h

puts "\rLoaded #{all_channels.size} channels. Filtered to the #{channels.size} ones you're a member of."

# If no sidebar_rules provided, suggest some!
if !sidebar_rules.any?
  puts
  puts "PREFIX SUGGESTIONS"
  puts "====================="
  puts
  puts "You haven't provided any sidebar_rules, so here are some"
  puts "ideas based on channels in your workspace:"
  puts

  # Let's look at each sidebar section in turn and try to reverse engineer some
  # sensible rules for them.
  proposed_prefix_rules = sidebar_sections.flat_map do |sidebar_section|
    channel_names = channels.select { |_, c| sidebar_section.includes_channel?(c["id"]) }.map { |_, c| c["name"] }

    potential_prefixes = get_prefixes(channel_names)

    likely_prefixes = potential_prefixes
      .select { |k, v| v > 5 }                      # None with < 5 channels that use the prefix
      .select { |k, v| k.size < 20 }                # None that are "super long"
      .sort_by { |k, v| -v }                        # Sort most popular first
      .first(3)                                     # Pick top 3
      .map do |prefix, count|
        { "type" => "prefix", "sidebar_section" => sidebar_section.name, "prefix" => "#{prefix}-", "count" => count }
      end
  end

  # If a prefix appears in multiple rules, pick the rule which applies to the
  # most channels
  proposed_prefix_rules = proposed_prefix_rules
    .group_by { |rule| rule["prefix"] }
    .map { |prefix, rules| rules.sort_by { |rule| rule["count"] }.last }
    .map { |rule| rule.except("count") }

  # Sort the rules by sidebar section and then by prefix
  proposed_prefix_rules.sort_by! { |rule| [rule["sidebar_section"], rule["prefix"]] }

  # Yes, I am manually printing JSON. Sue me. Could use JSON.pretty_generate,
  # but it leads to pretty verbose output I'd rather avoid.
  puts "["
  puts proposed_prefix_rules
    .map(&:to_json)
    .map { |s| "    #{s.gsub(/","/, '", "')}"}
    .join(",\n")
  puts "]"

  # We can't do any more here

  puts
  puts "To dry-run, tweak and save the above in a rule.json file somewhere and run that"
  puts
  puts "    bundle exec ruby organize.rb #{ARGV[0]} rule.json --write"
  puts
  puts
  exit
end

total_matches = 0
sidebar_moves = []
channel_name_mapping = {}

channels.each do |channel_id, channel|
  rule = sidebar_rules.find { |rule| rule.applies?(channel["name"]) }
  next unless rule

  # A rule applied! Bump the counter
  total_matches += 1

  # Find the sidebar section
  to_sidebar_section = get_sidebar_section.call(rule.sidebar_section_id)

  # Nothing to do if already in this sidebar section!
  next if to_sidebar_section.includes_channel?(channel_id)

  # See if there's another section the channel belongs to (need to remember to remove it)
  from_sidebar_section = sidebar_sections.find { |section| section.includes_channel?(channel_id) }

  # Right, let's plan to move the channel!
  sidebar_moves << {
    channel_id: channel_id,
    from_sidebar_section_id: from_sidebar_section&.id,
    to_sidebar_section_id: to_sidebar_section.id,
  }
end

puts
puts "ORGANIZING SIDEBAR"
puts "=================="

puts "#{total_matches} channels match your sidebar rules."

if sidebar_moves.size == 0
  puts
  puts "Good news - your sidebar is already completely organized, so nothing to do here!"
  exit
end

puts
puts "#{sidebar_moves.size} #{sidebar_moves.size == 1 ? "is" : "are"} in the wrong place!"

if !write_changes
  puts
  puts "DRY RUN"
  puts "======="

  puts
  puts "You didn't pass a --write flag, so we're just going to do a dry run for now."
  puts
  puts "We would move:"
  puts

  sidebar_moves.each do |m|
    channel = channels[m[:channel_id]]
    from_sidebar_section = get_sidebar_section.call(m[:from_sidebar_section_id])
    to_sidebar_section = get_sidebar_section.call(m[:to_sidebar_section_id])

    puts "    #{channel["name"]} (#{m[:channel_id]}) ➜ #{to_sidebar_section.name} (#{to_sidebar_section.id})"
  end

  puts
  puts "---"
  puts
  puts "To actually move your channels, re-run this with a --write flag:"
  puts
  puts "    bundle exec ruby organize.rb #{ARGV[0]} #{ARGV[1]} --write"
  puts
  puts
  exit
end

puts
puts "Let's sort it! 💪"
puts
puts "Note: Rate limits are harsh here, so we'll do as many as we can, but"
puts "      the process will likely pause periodically whilst we let the"
puts "      rate limit recover."
puts

# TODO: Could do all removals and additions in a few bulk requests
# vs one at a time to *hugely* speed this up, although one-at-a-time
# is better for debugging and I don't know the API limits, so leaving
# it for now.
progress_bar = ProgressBar.create(
  format: "%e [%B] %c (%p%) Channels Organized",
  total: sidebar_moves.size,
  length: 80,
  projector: {
    type: 'smoothed',
    strength: 0.2
  }
)

# Slack are very aggressive on rate limits for this endpoint, so let's
# avoid hitting them to maximise chances we do this
# in one run!
#
# From experimenting, I think it's a Tier 2 (max 20/min).
limiter = Limiter::RateQueue.new(20, interval: 60)

errors = []
successful_moves = []

sidebar_moves.each do |m|
  channel = channels[m[:channel_id]]
  from_sidebar_section = get_sidebar_section.call(m[:from_sidebar_section_id])
  to_sidebar_section = get_sidebar_section.call(m[:to_sidebar_section_id])

  limiter.shift

  result = client.sidebar_move(
    channel_id: m[:channel_id],
    from_sidebar_section_id: from_sidebar_section&.id,
    to_sidebar_section_id: to_sidebar_section.id,
  )

  progress_bar.increment

  if result["ok"]
    successful_moves << m
  else
    errors << {
      channel_id: m[:channel_id],
      from_sidebar_section_id: from_sidebar_section&.id,
      to_sidebar_section_id: to_sidebar_section.id,
      result: result
    }
  end
end

puts
puts "Organized #{successful_moves.size} channels"

puts
puts "We moved:"
puts
sidebar_moves.each do |m|
  channel = channels[m[:channel_id]]
  from_sidebar_section = get_sidebar_section.call(m[:from_sidebar_section_id])
  to_sidebar_section = get_sidebar_section.call(m[:to_sidebar_section_id])

  puts "    #{channel["name"]} (#{m[:channel_id]}) ➜ #{to_sidebar_section.name} (#{to_sidebar_section.id})"
end

puts
puts "Summary:"
puts
sidebar_moves.group_by { |m| m[:to_sidebar_section_id] }.each do |sidebar_section_id, moves|
  sidebar_section = get_sidebar_section.call(sidebar_section_id)
  puts "    Moved #{moves.size} channels to #{sidebar_section.name}"
end

if errors.size > 0
  puts
  puts "Sadly #{errors.size} channels couldn't be moved:"
  puts
  errors.each { |err| puts "    #{err.inspect}" }
end

puts
puts "Enjoy your Zen 🧘✌️"
