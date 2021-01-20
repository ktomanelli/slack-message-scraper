/* eslint-disable prefer-destructuring */
/* eslint-disable camelcase */
const Slack = require('slack');
const fs = require('fs');
require('dotenv').config();

const token = process.env.SLACK_BOT_TOKEN;

const bot = new Slack({ token });

// gets single reply page
const getReplyPage = async (channel, cursor, ts) => {
  const replyArr = [];
  return new Promise((resolve, reject) => {
    setTimeout(async () => {
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
        resolve({
          replyHasMore: res.has_more,
          replyCursor: res.response_metadata.next_cursor,
          replyArr,
        });
      } else if (!res.has_more) {
        resolve({ replyArr, replyHasMore: res.has_more });
      } else {
        reject();
      }
    }, 1000);
  });
};

// gets all replies to specified message
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

// gets single message page + all replies on each message
const getMessagePage = async (channel, cursor) => {
  const messageArr = [];
  return new Promise((resolve, reject) => {
    setTimeout(async () => {
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
        resolve({
          messageArr,
          has_more: res.has_more,
          cursor: res.response_metadata.next_cursor,
        });
      } else if (!res.has_more) {
        resolve({
          messageArr,
          has_more: res.has_more,
        });
      } else {
        reject();
      }
    }, 2000);
  });
};

// gets all messages
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

// gets all channels in workspace *that bot has access to
// bot needs to be added to private channel for channel to show in this list
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

// gets all members in workspace
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

// collects member data and channel data, iterates through channels gets all messages for each
const collectAll = async () => {
  const botInfo = await bot.auth.test();
  const channels = await getChannels();
  const members = await getMembers();
  if (!fs.existsSync('./data/members.json')) {
    console.log('no file, creating now...');
    fs.writeFileSync(`./data/members.json`, JSON.stringify(members));
    console.log('created');
  }
  for (const channel of channels) {
    if (!fs.existsSync(`./data/${channel.name}.json`)) {
      if (channel.is_archived) {
        continue;
      } else if (channel.num_members < 0 || channel.is_group) {
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
      fs.writeFileSync(`./data/${channel.name}.json`, JSON.stringify(channel));
      console.log('file saved successfully');
    }
  }
};

// collects all data and saves to files
collectAll().catch(e => console.error(e));
