import CacheManager from '../cache';
import {chatService} from './chat-service';
/** Invalidate the recipient's private list before foreground clients refetch it. */
export async function publishStoredNotification(userId:string,type:string,data:Record<string,unknown>):Promise<void>{
 await CacheManager.clearByPattern(`notifications:postgres:${userId}:`).catch(()=>{});
 chatService.sendToUser(userId,{type:`notification:${type}`,data});
}
