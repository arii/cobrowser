// Durable local action archive. The recorder's small live window is not the history.
let database;
function open(){
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open('cobrowser-action-history',2);
    request.onupgradeneeded=()=>{
      const db=request.result;
      const events=db.objectStoreNames.contains('events')?request.transaction.objectStore('events'):db.createObjectStore('events',{keyPath:'sequence',autoIncrement:true});
      if(!events.indexNames.contains('id'))events.createIndex('id','id',{unique:true});
      if(!events.indexNames.contains('at'))events.createIndex('at','event.at');
      if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta');
    };
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Local action history could not be opened.'));
  });
  return database;
}
export async function retainAction(event,generation){
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('events','readwrite'),store=tx.objectStore('events'),lookup=store.index('id').get(event.id);
    lookup.onsuccess=()=>{const previous=lookup.result;store.put({...previous,id:event.id,generation,event});};
    tx.oncomplete=()=>resolve();tx.onabort=()=>reject(new Error('Local action history could not be saved.'));
  });
}
export async function pendingActions(generation){
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['events','meta'],'readonly'),meta=tx.objectStore('meta').get('nativeAck');
    meta.onsuccess=()=>{
      const entries=[],request=tx.objectStore('events').openCursor(IDBKeyRange.lowerBound(meta.result??0,true));
      request.onsuccess=()=>{const cursor=request.result;if(!cursor || entries.length===64){resolve(entries);return;}if(cursor.value.generation===generation)entries.push(cursor.value);cursor.continue();};
    };
    tx.onabort=()=>reject(new Error('Local action history could not be read.'));
  });
}
export async function acknowledgeActions(sequence){
  const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put(sequence,'nativeAck');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(new Error('Local action acknowledgment failed.'));});
}
export async function readAllActions(){
  const db=await open();return new Promise((resolve,reject)=>{const request=db.transaction('events').objectStore('events').getAll();request.onsuccess=()=>resolve(request.result.map(item=>item.event));request.onerror=()=>reject(new Error('Local action history could not be exported.'));});
}
export async function readTaskActions(openedAt){
  const db=await open();return new Promise((resolve,reject)=>{
    const request=db.transaction('events').objectStore('events').index('at').getAll(openedAt?IDBKeyRange.lowerBound(openedAt):undefined);
    request.onsuccess=()=>resolve(request.result.map(item=>item.event));request.onerror=()=>reject(new Error('Local task actions could not be read.'));
  });
}
export async function clearActions(){
  const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(['events','meta'],'readwrite');tx.objectStore('events').clear();tx.objectStore('meta').clear();tx.oncomplete=()=>resolve();tx.onabort=()=>reject(new Error('Local action history could not be cleared.'));});
}
