require "uri"
require 'net/http'
require 'json'

def best_prefix(channel_name, prefixes)
  prefixes
    .select { |prefix| channel_name.start_with?(prefix) }
    .sort_by(&:size)
    .last
end

def get_prefixes(channel_names)
  # Generate a list of prefix candidates, assuming "-" as the separator
  prefix_candidates = Hash.new(0)
  channel_names.each do |name|
    parts = name.split('-')
    parts = parts[0..-2] # Cut off the last section
    parts = parts[0..3] # Only treat first 4 sections as prefixes
    parts.each_index { |i| prefix_candidates[parts[0..i].join('-')] += 1 }
  end
  prefix_candidates
end

def unzip(body)
  gz = Zlib::GzipReader.new(StringIO.new(body.to_s))
  gz.read
end

def parse_curl_command(curl_command)
  # Extract the URL from the curl command
  url_match = curl_command.match(/curl '([^']+)'/)
  url = url_match[1] if url_match

  # Extract headers
  headers = {}
  curl_command.scan(/-H '([^']+)'/).flatten.each do |header|
    key, value = header.split(': ', 2)
    headers[key] = value
  end

  # Extract data
  data_match = curl_command.match(/--data-raw \$'([^']+)'/)
  data = data_match[1] if data_match

  token = token_from_body(data)

  { uri: URI(url), headers: headers, data: data, token: token }
end

# Convert CURL request to a ruby request
def curl_to_ruby_request(curl_command)
  r = parse_curl_command(curl_command)
  url = URI(r[:url])
  headers = r[:headers]
  data = r[:data]

  request = Net::HTTP::Post.new(url)
  headers.each { |key, value| request[key] = value }
  request.body = data

  http = Net::HTTP.new(url.host, url.port)
  http.use_ssl = true

  return request, http
end

def token_from_body(s)
  token_regex = /^xoxc-.*$/
  match = s.match(token_regex)
  match ? match[0] : nil
end

def update_uri_params(uri, params)
  uri = URI(uri)
  new_query = URI.decode_www_form(uri.query || '')
  params.each { |k, v| new_query << [k, v] }
  uri.query = URI.encode_www_form(new_query)
  uri
end

class SidebarSection
  def self.from_json(json)
    new(
      json["channel_section_id"],
      json["name"],
      json["channel_ids_page"]["channel_ids"]
    )
  end

  attr_reader :id, :channel_ids, :name

  def initialize(id, name, channel_ids)
    @id = id
    @name = name
    @channel_ids = channel_ids
  end

  def includes_channel?(channel_id)
    @channel_ids.include?(channel_id)
  end
end

class SidebarRule
  def self.from_json(id, json)
    case json["type"]
    when "prefix" then PrefixSidebarRule.new(id, json["prefix"])
    when "keyword" then KeywordSidebarRule.new(id, json["keyword"])
    else raise "Didn't understand sidebar rule #{json}"
    end
  end

  attr_reader :sidebar_section_id

  def applies?(channel_name)
    raise "Not implemented"
  end

  def to_s
    raise "Not implemented"
  end
end

class PrefixSidebarRule < SidebarRule
  attr_reader :prefix

  def initialize(sidebar_section_id, prefix)
    @sidebar_section_id = sidebar_section_id
    @prefix = prefix
  end

  def applies?(channel_name)
    channel_name.start_with?(prefix)
  end

  def to_s
    "Prefix: ##{prefix}"
  end
end

class KeywordSidebarRule < SidebarRule
  attr_reader :keyword

  def initialize(sidebar_section_id, keyword)
    @sidebar_section_id = sidebar_section_id
    @keyword = keyword
  end

  def applies?(channel_name)
    channel_name.include?(keyword)
  end

  def to_s
    "Keyword: ##{keyword}"
  end
end

# lol "client". It'll do, though
class SlackClient
  def initialize(base_uri:, cookie:, token:)
    @base_uri = base_uri
    @cookie = cookie
    @token = token
  end

  def get_sidebar_list
    body = %Q(
------BOUNDARY
Content-Disposition: form-data; name="token"

#{@token}
------BOUNDARY
)

    make_request(
      path: "/api/users.channelSections.list",
      body: body
    )
  end

  # TODO: Could we filter this down in the API call? Who knows, look later.
  def get_channels(cursor: nil, fetched: nil)
    params = {"limit" => 1000}
    params["cursor"] = cursor if cursor

    body = %Q(
------BOUNDARY
Content-Disposition: form-data; name="token"

#{@token}
------BOUNDARY
Content-Disposition: form-data; name="types"

public_channel,private_channel
------BOUNDARY

)

    json = make_request(
      path: "/api/conversations.list",
      body: body,
      params: params,
    )

    if json["error"] == "ratelimited"
      puts "Uh-oh, hit rate limits. Wait 60s, then try again"
      exit
    end

    fetched.call unless fetched.nil?

    next_cursor = json.dig("response_metadata", "next_cursor")

    channels = json["channels"] || []

    if next_cursor != "" && next_cursor != nil
      channels += get_channels(cursor: next_cursor, fetched: fetched)
    end

    return channels.sort_by { |c| c["name"] }
  end

  def sidebar_move(channel_id:,to_sidebar_section_id:,from_sidebar_section_id: nil)
    body = %Q(
------BOUNDARY
Content-Disposition: form-data; name="token"

#{@token}
------BOUNDARY
Content-Disposition: form-data; name="insert"

[{"channel_section_id":"#{to_sidebar_section_id}","channel_ids":["#{channel_id}"]}]
------BOUNDARY
)

    if from_sidebar_section_id
      body += %Q(
------BOUNDARY
Content-Disposition: form-data; name="remove"

[{"channel_section_id":"#{from_sidebar_section_id}","channel_ids":["#{channel_id}"]}]
)
    end

    make_request(
      path: "/api/users.channelSections.channels.bulkUpdate",
      body: body
    )
  end

  private

  def make_request(path:, body:, params:{})
    uri = URI(@base_uri)
    uri.path = path

    new_query = URI.decode_www_form(uri.query || '')
    params.each { |k, v| new_query << [k, v] }
    uri.query = URI.encode_www_form(new_query)

    request = Net::HTTP::Post.new(uri)
    request["cookie"] = @cookie
    request["content-type"] = "multipart/form-data; boundary=----BOUNDARY"
    request.body = body

    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    response = http.request(request)
    b = response.body
    b = unzip(b) if response["content-encoding"] == "gzip"
    JSON.parse(b)
  end
end
