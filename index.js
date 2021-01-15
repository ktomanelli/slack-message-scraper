/* eslint-disable prefer-destructuring */
/* eslint-disable camelcase */
const Slack = require('slack');
const fs = require('fs');
require('dotenv').config();

const token = process.env.SLACK_BOT_TOKEN;

const bot = new Slack({ token });

const getReplyPage = async (channel, cursor, ts) => {
  const replyArr = [];
  const res = await bot.conversations.replies({
    token,
    channel,
    ts,
    cursor,
    inclusive: true,
  });
  for (const reply of res.messages) {
    if (reply.ts !== ts) {
      replyArr.push(reply);
    }
  }
  if (res.has_more) {
    return {
      replyHasMore: res.has_more,
      replyCursor: res.response_metadata.next_cursor,
      replyArr,
    };
  }
  return { replyArr, replyHasMore: res.has_more };
};

const getReplies = async (channel, ts) => {
  const replies = [];
  const firstReplyPage = await getReplyPage(channel, '', ts);
  replies.push(...firstReplyPage.replyArr);
  let { replyCursor } = firstReplyPage;
  let { replyHasMore } = firstReplyPage;
  while (replyHasMore) {
    const nextReplyPage = await getReplyPage(channel, replyCursor, ts);
    replies.push(...nextReplyPage.replyArr);
    replyCursor = nextReplyPage.cursor;
    replyHasMore = nextReplyPage.has_more;
  }
  return replies;
};

const getMessagePage = async (channel, cursor) => {
  const messageArr = [];
  const res = await bot.conversations.history({
    token,
    channel,
    cursor,
    inclusive: true,
  });
  for (const message of res.messages) {
    if (message.reply_count) {
      const replies = await getReplies(channel, message.ts);
      message.replies = replies;
    }
    messageArr.push(message);
  }
  if (res.has_more) {
    return {
      messageArr,
      has_more: res.has_more,
      cursor: res.response_metadata.next_cursor,
    };
  }
  return {
    messageArr,
    has_more: res.has_more,
  };
};

const getMessages = async channel => {
  const messages = [];
  const firstPage = await getMessagePage(channel, '');
  messages.push(...firstPage.messageArr);
  let { cursor } = firstPage;
  let { has_more } = firstPage;
  while (has_more) {
    const nextPage = await getMessagePage(channel, cursor);
    messages.push(...nextPage.messageArr);
    cursor = nextPage.cursor;
    has_more = nextPage.has_more;
  }
  return messages;
};

const getChannels = async () => {
  const channels = [];

  const res = await bot.conversations.list({
    types: 'public_channel, private_channel',
  });
  channels.push(...res.channels);
  let hasMoreChannels = res.response_metadata.next_cursor;
  if (hasMoreChannels) {
    while (hasMoreChannels) {
      const nextChannelPage = await bot.conversations.list({
        cursor: hasMoreChannels,
        types: 'public_channel, private_channel',
      });
      channels.push(...nextChannelPage.channels);
      hasMoreChannels = nextChannelPage.response_metadata.next_cursor;
    }
  }
  return channels;
};
const getMembers = async () => {
  const members = [];
  const res = await bot.users.list();
  members.push(...res.members);
  let hasMoreMembers = res.response_metadata.next_cursor;
  if (hasMoreMembers) {
    while (hasMoreMembers) {
      const nextMemberPage = await bot.users.list({
        cursor: hasMoreMembers,
      });
      members.push(...nextMemberPage.members);
      hasMoreMembers = nextMemberPage.response_metadata.next_cursor;
    }
  }
  return members;
};

const collectAll = async () => {
  const botInfo = await bot.auth.test();

  const data = {};
  const channels = await getChannels();
  const members = await getMembers();
  data.members = members;
  data.channels = [];
  for (const channel of channels) {
    if (channel.num_members < 0 || channel.is_group) {
      const convMemebers = await bot.conversations.members({
        channel: channel.id,
      });
      if (!convMemebers.members.includes(botInfo.user_id)) {
        await bot.conversations.join({ channel: channel.id });
      }
    } else {
      await bot.conversations.join({ channel: channel.id });
    }
    console.log(`collecting messages from ${channel.name}...`);
    const messages = await getMessages(channel.id);
    channel.messages = messages;
    // console.log(channel);
    data.channels.push(channel);
  }
  return data;
};

collectAll()
  .then(data => {
    fs.writeFileSync('./slackData.json', JSON.stringify(data));
    console.log('file saved successfully');
  })
  .catch(e => console.error(e));
