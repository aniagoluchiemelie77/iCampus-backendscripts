import express from "express";
import { createNotification } from "../services/notificationService.js";
import { Follow, User, Posts } from "../tableDeclarations.js";
import {
  generateNotificationId,
  generatePostId,
} from "../utils/idGenerator.js";
import { extractMentions } from "../utils/postMentionsRegex.js";

export const createPost = async (req, res) => {
    try {
      const { content, media, poll, isSubscriptionContent } = req.body;
      const userId = req.user.uid;

      let processedMedia = media;
      if (media?.mediaType === "video" && Array.isArray(media.url)) {
        processedMedia.url = [media.url[0]];
      }

      const author = await User.findOne({ uid: userId }).select(
        "firstname lastname username profilePic",
      );
      if (!author) return res.status(404).json({ message: "Author not found" });
      const authorName = `${author.firstname} ${author.lastname}`;

      const newPost = new Posts({
        postId: generatePostId(),
        originalAuthor: userId,
        content,
        isSubscriptionContent: isSubscriptionContent || false,
        media: processedMedia,
        postType: poll ? "poll" : "media",
        poll: poll
          ? {
              options: poll.options.map((opt, index) => ({
                optionId: `opt_${Date.now()}_${index}`,
                text: opt.text,
                votes: [],
              })),
              totalVotes: 0,
              expiresAt:
                poll.expiresAt ||
                new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            }
          : null,
      });

      await newPost.save();

      const mentionedUsernames = extractMentions(content);
      let notifiedUids = new Set();
      if (mentionedUsernames.length > 0) {
        const mentionedUsers = await User.find({
          username: { $in: mentionedUsernames },
        }).select("uid");
        mentionedUsers.forEach((user) => {
          notifiedUids.add(user.uid);
          createNotification({
            notificationId: generateNotificationId("social"),
            recipientId: user.uid,
            category: "social",
            actionType: "POST_MENTION",
            title: "You were mentioned",
            message: `${authorName} mentioned you in a post.`,
            payload: { postId: newPost._id, authorId: userId },
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          });
        });
      }

      // Notify Followers
      const followers = await Follow.find({ followingId: userId }).select(
        "followerId",
      );
      followers.forEach((follow) => {
        if (
          !notifiedUids.has(follow.followerId) &&
          follow.followerId !== userId
        ) {
          createNotification({
            notificationId: generateNotificationId("social"),
            recipientId: follow.followerId,
            category: "social",
            actionType: "NEW_POST",
            title: `New Post from ${authorName}`,
            message: `${authorName} just shared a new update.`,
            payload: { postId: newPost._id, authorId: userId },
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          });
        }
      });

      // iScore updates
      if (req.user.usertype !== "enterprise") {
        await User.updateOne(
          { uid: req.user.uid },
          { $inc: { "monthlyStats.libraryUsageSessions": 1 } },
        );
      }

      res
        .status(201)
        .json({ message: "Post created successfully", data: newPost });
    } catch (error) {
      console.error("Create Post Error:", error);
      res.status(500).json({ message: error.message });
    }
  }
export const updatePost = async (req, res) => {
    try {
      const { postId } = req.params;
      const { content, media, poll, isSubscriptionContent } = req.body;
      const userId = req.user.uid;
      const post = await Posts.findOne({ postId, originalAuthor: userId });
      if (!post) {
        return res
          .status(404)
          .json({ message: "Post not found or unauthorized to edit." });
      }

      let processedMedia = media;
      if (media?.mediaType === "video" && Array.isArray(media.url)) {
        processedMedia.url = [media.url[0]];
      }
      post.content = content;
      post.media = processedMedia;
      post.isSubscriptionContent =
        isSubscriptionContent ?? post.isSubscriptionContent;
      if (poll && post.poll) {
        post.poll.options = poll.options.map((opt, index) => {
          const existingOpt = post.poll.options.find(
            (o) => o.text === opt.text,
          );
          return {
            optionId: existingOpt
              ? existingOpt.optionId
              : `opt_${Date.now()}_${index}`,
            text: opt.text,
            votes: existingOpt ? existingOpt.votes : [],
          };
        });
        post.poll.totalVotes = post.poll.options.reduce(
          (sum, o) => sum + o.votes.length,
          0,
        );
      }

      await post.save();
      const author = await User.findOne({ uid: userId }).select(
        "firstname lastname",
      );
      const authorName = author
        ? `${author.firstname} ${author.lastname}`
        : "Someone";

      const explicitUsernames = extractMentions(content);
      if (explicitUsernames.length > 0) {
        const usersToTag = await User.find({
          username: { $in: explicitUsernames },
        }).select("uid");
        for (const targetUser of usersToTag) {
          createNotification({
            notificationId: generateNotificationId("social"),
            recipientId: targetUser.uid,
            category: "social",
            actionType: "POST_MENTION",
            title: "You were mentioned",
            message: `${authorName} mentioned you in an updated post.`,
            payload: { postId: post._id, authorId: userId },
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          });
        }
      }

      res
        .status(200)
        .json({ message: "Post updated successfully" });
    } catch (error) {
      console.error("Update Post Error:", error);
      res.status(500).json({ message: error.message });
    }
  }  