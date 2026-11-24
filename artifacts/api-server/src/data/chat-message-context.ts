/** One bounded chronological window, with the identical eligibility predicate
 * for its anchor and both sides. Callers supply only fixed server SQL. */
export function messageContextSQL(table:'direct_messages'|'chat_group_messages'|'station_chat_messages',select:string,eligible:string,targetParameter:string):string {
  return `WITH context_target AS (
    SELECT m.id,m.created_at FROM ${table} m WHERE ${eligible} AND m.id=${targetParameter}
  ), context_older AS (
    SELECT m.id,m.created_at FROM ${table} m CROSS JOIN context_target t
    WHERE ${eligible} AND (m.created_at,m.id)<(t.created_at,t.id)
    ORDER BY m.created_at DESC,m.id DESC LIMIT 26
  ), context_newer AS (
    SELECT m.id,m.created_at FROM ${table} m CROSS JOIN context_target t
    WHERE ${eligible} AND (m.created_at,m.id)>(t.created_at,t.id)
    ORDER BY m.created_at ASC,m.id ASC LIMIT 25
  ), context_ids AS (
    (SELECT id FROM context_older ORDER BY created_at DESC,id DESC LIMIT 25)
    UNION ALL SELECT id FROM context_target
    UNION ALL SELECT id FROM context_newer
  ) ${select.replace(/^SELECT\s+/i,'SELECT (SELECT count(*)>25 FROM context_older) AS "_contextHasMore",')}
    WHERE m.id IN (SELECT id FROM context_ids) ORDER BY m.created_at ASC,m.id ASC`;
}
export function messageContextRows<T extends Record<string,any>>(rows:T[],target:string):{messages:Omit<T,'_contextHasMore'>[];hasMore:boolean;targetFound:boolean}{
  const targetFound=rows.some(row=>(row._id||row.id)===target&&!row.deletedAt&&!row.deleted_at);
  if(!targetFound)return {messages:[],hasMore:false,targetFound:false};
  return {messages:rows.map(({_contextHasMore,...message})=>message),hasMore:rows[0]?._contextHasMore===true,targetFound:true};
}
