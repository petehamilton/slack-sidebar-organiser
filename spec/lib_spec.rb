require 'rspec'
require "spec_helper"
require "./lib"

RSpec.describe "#best_prefix" do
  it "handles no matches" do
    expect(best_prefix("my-channel-name", ["project", "cust"])).to be_nil
  end

  it "handles simple matches" do
    expect(best_prefix("project-testing", ["project", "cust"])).to eq("project")
  end

  it "handles subset matches" do
    expect(best_prefix("cust-widgets-inc", ["project", "cust", "cust-vip"])).to eq("cust")
    expect(best_prefix("cust-vip-linear", ["project", "cust", "cust-vip"])).to eq("cust-vip")
  end
end

RSpec.describe "#get_prefixes" do
  it 'returns the most common prefixes with their counts' do
    channel_names = [
      "project-alpha",
      "project-beta",
      "customer-a",
      "customer-b",
      "customer-c",
      "some-other-channel"
    ]

    expect(get_prefixes([
      "project-alpha",
      "project-beta",
      "customer-a",
      "customer-b",
      "customer-c",
      "some-other-channel"
    ])).to eq({
      "customer"=>3,
      "project"=>2,
      "some"=>1,
      "some-other"=>1
    })
  end

  it 'handles a list with channels that have no common prefixes' do
    expect(get_prefixes([
      "dog-walk",
      "cat-nap",
      "fish-swim"
    ])).to eq({
      "dog" => 1,
      "cat" => 1,
      "fish" => 1
    })
  end

  it "handles channels with no prefix" do
    expect(get_prefixes([
      "customer-a",
      "something",
    ])).to eq({
      "customer" => 1
    })
  end
end
