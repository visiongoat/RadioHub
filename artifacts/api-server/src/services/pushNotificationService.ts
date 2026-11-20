import {pgListNotifications} from '../data/postgres-notification-store';
import webpush from 'web-push';
import { pgPushDevices } from '../data/postgres-push-store';
import {expoPushRequest} from './expo-push-client';
import {recordPushTicket} from './push-receipts';
import {
  pgFindUserById,
  pgGetUserPushSubscription,
  pgListUserPushSubscriptions,
  pgSetUserPushSubscription,
} from '../data/postgres-user-store';

// Configure web-push with VAPID keys (for browser/web push)
// Only configure if keys are present (not available in all environments)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:admin@megaradio.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  badgeCount?:number;
  image?: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
  data?: any;
}

// Tickets acknowledge Expo queue acceptance; receipts separately track APNs/FCM handoff.
async function sendExpoNotifications(devices:{id:string;token:string}[],payload:NotificationPayload):Promise<number>{
 const eligible=devices.filter(device=>/^(?:ExponentPushToken|ExpoPushToken)\[/.test(device.token));
 let accepted=0;
 for(let offset=0;offset<eligible.length;offset+=100){
  const batch=eligible.slice(offset,offset+100);
  const result=await expoPushRequest('send',batch.map(device=>({to:device.token,title:payload.title,body:payload.body,data:{...(payload.data||{}),url:payload.url,tag:payload.tag},sound:'default',priority:'high',badge:payload.badgeCount??1,mutableContent:['new_message','group_invitation','follow','station_mention'].includes(payload.data?.type),channelId:['new_message','station_mention'].includes(payload.data?.type)?'messages':payload.data?.type==='follow'?'followers':'default'})));
  if(!Array.isArray(result?.data))continue;
  for(let index=0;index<batch.length;index++){
   const ticket=result.data[index];
   // Receipt persistence failure must not resend a notification already accepted by Expo.
   if(ticket?.status==='ok'&&typeof ticket.id==='string'&&ticket.id)accepted++;
   await recordPushTicket(batch[index],ticket).catch(()=>console.warn('[push] Could not record provider ticket'));
  }
 }
 return accepted;
}

export class PushNotificationService {
  /**
   * Send push notification to a user via their stored mobile push tokens (iOS/Android)
   */
  static async sendToMobileUser(userId: string, payload: NotificationPayload): Promise<boolean> {
    try {
      const tokens: {id:string;token:string}[] = [];
      for await (const device of pgPushDevices({ userId })) tokens.push({id:device.id,token:device.token});
      if (!tokens.length) return false;
      const unread=await pgListNotifications(userId,1,1);
      const sent = await sendExpoNotifications(tokens, {...payload,badgeCount:unread.unreadCount});
      return sent > 0;
    } catch {
      return false;
    }
  }

  /**
   * Send a push notification to a specific user (web/browser push via VAPID)
   */
  static async sendToUser(userId: string, payload: NotificationPayload): Promise<boolean> {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
    try {
      const pushSubscription: any = await pgGetUserPushSubscription(userId);
      if (!pushSubscription) return false;

      const notificationPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon || '/favicon.png',
        badge: payload.badge || '/favicon.png',
        image: payload.image,
        url: payload.url || '/',
        tag: payload.tag || 'default',
        requireInteraction: payload.requireInteraction || false,
        actions: payload.actions || [],
        data: payload.data || {},
        timestamp: Date.now()
      });

      await webpush.sendNotification(pushSubscription, notificationPayload);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send to user via ALL channels: web push + mobile push tokens
   */
  static async sendToUserAllChannels(userId: string, payload: NotificationPayload, options:{skipWeb?:boolean}={}): Promise<boolean> {
    try {
      const user = await pgFindUserById(userId);
      if (!user) return false;
      const preferences = {pushEnabled:true,messages:true,followers:true,favorites:true,nowPlaying:true,recommendations:false,...user.notificationSettings};
      const category=({'group_invitation':'messages','new_message':'messages','station_mention':'messages',follow:'followers','favorite-added':'favorites','now-playing':'nowPlaying',recommendations:'recommendations'} as const)[payload.data?.type as 'new_message'|'station_mention'|'follow'|'favorite-added'|'now-playing'|'recommendations'];
      if(preferences.pushEnabled===false||(category&&preferences[category]===false))return false;
    } catch { return false; }
    const [web, mobile] = await Promise.allSettled([
      options.skipWeb ? Promise.resolve(false) : this.sendToUser(userId, payload),
      this.sendToMobileUser(userId, payload),
    ]);
    const webOk = web.status === 'fulfilled' && web.value;
    const mobileOk = mobile.status === 'fulfilled' && mobile.value;
    return webOk || mobileOk;
  }

  /**
   * Send a push notification to multiple users
   */
  static async sendToMultipleUsers(userIds: string[], payload: NotificationPayload): Promise<number> {
    // Fan-out concurrency cap. A broadcast to 50k subscribers without a cap
    // creates 50k concurrent fetch promises against Web-Push and Expo APIs:
    // socket descriptor exhaustion, RSS spike from buffered request bodies,
    // and rate-limit bans from upstream. Cap at 6 in-flight workers and
    // stream the work through; total memory is O(concurrency), not O(N).
    const CONCURRENCY = 6;
    let succeeded = 0;
    let cursor = 0;
    const total = userIds.length;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(CONCURRENCY, total); w++) {
      workers.push((async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= total) return;
          try {
            const ok = await this.sendToUserAllChannels(userIds[idx], payload);
            if (ok) succeeded++;
          } catch {}
        }
      })());
    }
    await Promise.all(workers);
    return succeeded;
  }

  /**
   * Send a broadcast notification to all users with push subscriptions
   */
  static async broadcast(payload: NotificationPayload): Promise<number> {
    try {
      // Stream user IDs in batches via cursor to avoid loading 10k+ docs into RAM
      const BATCH_SIZE = 500;
      let totalSent = 0;
      {
        let offset = 0;
        while (true) {
          const rows = await pgListUserPushSubscriptions(offset, BATCH_SIZE);
          if (!rows.length) break;
          totalSent += await this.sendToMultipleUsers(rows.map((row) => row.id), payload);
          if (rows.length < BATCH_SIZE) break;
          offset += rows.length;
        }
        return totalSent;
      }
    } catch {
      return 0;
    }
  }

  /**
   * Send a follow notification to the followed user (both web + mobile)
   */
  static async sendFollowNotification(
    followedUserId: string,
    followerName: string,
    followerSlug?: string,
    followerId?: string,
    followerAvatar?:string
  ): Promise<boolean> {
    const payload: NotificationPayload = {
      title: followerName,
      body: 'Seni takip etmeye başladı.',
      icon: '/favicon.png',
      badge: '/favicon.png',
      url: followerSlug ? `/community/profile/${followerSlug}` : '/community',
      tag: 'follow',
      requireInteraction: false,
      data: {
        type: 'follow',
        followerName,
        userName:followerName,userAvatar:followerAvatar||'',
        followerSlug,
        screen: 'user-profile',
        userId: followerId,
      }
    };

    return await this.sendToUserAllChannels(followedUserId, payload);
  }

  /**
   * Send a now playing notification for a radio station
   */
  static async sendNowPlayingNotification(userId: string, stationData: {
    name: string;
    nowPlaying?: string;
    artist?: string;
    title?: string;
    genre?: string;
    favicon?: string;
    homepage?: string;
  }): Promise<boolean> {
    const nowPlaying = stationData.nowPlaying ||
      (stationData.artist && stationData.title ?
        `${stationData.artist} - ${stationData.title}` :
        stationData.name);

    const payload: NotificationPayload = {
      title: `🎵 ${stationData.name}`,
      body: `${nowPlaying}${stationData.genre ? ` • ${stationData.genre}` : ''}`,
      icon: stationData.favicon || '/favicon.png',
      badge: '/favicon.png',
      url: stationData.homepage || '/',
      tag: 'now-playing',
      requireInteraction: false,
      actions: [
        { action: 'play', title: '▶️ Play' },
        { action: 'favorite', title: '❤️ Favorite' }
      ],
      data: {
        type: 'now-playing',
        stationName: stationData.name,
        nowPlaying,
        genre: stationData.genre,
        homepage: stationData.homepage
      }
    };

    return await this.sendToUserAllChannels(userId, payload);
  }

  /**
   * Send a favorite added notification
   */
  static async sendFavoriteAddedNotification(userId: string, stationData: {
    stationId: string;
    name: string;
    country?: string;
    genre?: string;
    favicon?: string;
  }): Promise<boolean> {
    const payload: NotificationPayload = {
      title: '❤️ Station Added to Favorites',
      body: `${stationData.name}${stationData.genre ? ` • ${stationData.genre}` : ''}${stationData.country ? ` • ${stationData.country}` : ''}`,
      icon: stationData.favicon || '/favicon.png',
      badge: '/favicon.png',
      url: '/',
      tag: 'favorite-added',
      requireInteraction: false,
      actions: [
        { action: 'view', title: '🎵 Listen Now' }
      ],
      data: {
        type: 'favorite-added',
        stationId: stationData.stationId,
        stationName: stationData.name
      }
    };

    return await this.sendToUserAllChannels(userId, payload);
  }

  /**
   * Send a station recommendation notification
   */
  static async sendStationRecommendation(userId: string, stations: Array<{
    name: string;
    genre?: string;
    country?: string;
    favicon?: string;
  }>): Promise<boolean> {
    if (stations.length === 0) return false;

    const firstStation = stations[0];
    const additionalCount = stations.length - 1;

    const payload: NotificationPayload = {
      title: '🎧 New Station Recommendations',
      body: `${firstStation.name}${additionalCount > 0 ? ` and ${additionalCount} more stations` : ''} ${firstStation.genre ? `• ${firstStation.genre}` : ''}`,
      icon: firstStation.favicon || '/favicon.png',
      badge: '/favicon.png',
      url: '/',
      tag: 'recommendations',
      requireInteraction: false,
      actions: [
        { action: 'explore', title: '🔍 Explore' }
      ],
      data: {
        type: 'recommendations',
        stations
      }
    };

    return await this.sendToUserAllChannels(userId, payload);
  }

  /**
   * Clean up invalid push subscriptions
   */
  static async cleanupInvalidSubscriptions(): Promise<number> {
    try {
      // Stream via cursor — never load all subscribed users into memory
      let removedCount = 0;
      {
        let offset = 0;
        const batchSize = 200;
        while (true) {
          const rows = await pgListUserPushSubscriptions(offset, batchSize);
          if (!rows.length) break;
          for (const user of rows) {
            try {
              await webpush.sendNotification(user.subscription as any, JSON.stringify({
                title: 'Test', body: 'Connection test', silent: true,
              }));
              offset += 1;
            } catch (error: any) {
              if (error.statusCode === 410 || error.statusCode === 404) {
                await pgSetUserPushSubscription(user.id, null);
                removedCount++;
              } else {
                offset += 1;
              }
            }
          }
          if (rows.length < batchSize) break;
        }
        return removedCount;
      }
    } catch {
      return 0;
    }
  }
}
