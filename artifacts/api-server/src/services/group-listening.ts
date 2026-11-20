export interface GroupRadioPresence {userId:string;groupId:string;stationId:string;name:string;logo?:string;expiresAt:number}
type Client={revision:number;seenAt:number;entry:GroupRadioPresence|null};
/** Ephemeral group presence, with ordered per-device updates and no listening history. */
export class GroupListeningRegistry {
 private users=new Map<string,Map<string,Client>>();
 private nextSweep=0;
 update(userId:string,groupId:string,station:{stationId:string;name:string;logo?:string}|null,clientId:string,revision:number,now=Date.now()){
  if(now>=this.nextSweep){this.nextSweep=now+30000;for(const [id,clients] of this.users){for(const [client,record]of clients)if(record.seenAt+120000<now)clients.delete(client);if(!clients.size)this.users.delete(id);}}
  const clients=this.users.get(userId)||new Map<string,Client>(),previous=clients.get(clientId);if(previous&&revision<=previous.revision)return false;
  if(!previous&&clients.size>=5)clients.delete(clients.keys().next().value!);
  clients.set(clientId,{revision,seenAt:now,entry:station?{userId,groupId,...station,expiresAt:now+35000}:null});this.users.set(userId,clients);return true;
 }
 members(groupId:string,memberIds:string[],now=Date.now()){
  return memberIds.flatMap(id=>{const entries=[...(this.users.get(id)?.values()||[])].flatMap(record=>record.entry?.groupId===groupId&&record.entry.expiresAt>now?[record.entry]:[]).sort((a,b)=>b.expiresAt-a.expiresAt);return entries.slice(0,1);});
 }
}
export const groupListening=new GroupListeningRegistry();
