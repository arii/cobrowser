// Chrome native messaging: bounded little-endian length-prefixed JSON.
export const MAX_NATIVE_BYTES=1024*1024;
export function nativeFrame(value:unknown) {
  const body=Buffer.from(JSON.stringify(value));
  if(body.length>MAX_NATIVE_BYTES)throw new Error('native-message-too-large');
  const header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);
}
export function nativeDecoder(onMessage:(value:unknown)=>void,onError:()=>void) {
  let buffered=Buffer.alloc(0),failed=false;
  return (chunk:Buffer)=>{
    if(failed)return;
    buffered=Buffer.concat([buffered,chunk]);
    try {
      while(buffered.length>=4){
        const size=buffered.readUInt32LE();if(!size||size>MAX_NATIVE_BYTES)throw new Error('native-length-invalid');
        if(buffered.length<size+4)return;
        const value:unknown=JSON.parse(buffered.subarray(4,size+4).toString());buffered=buffered.subarray(size+4);onMessage(value);
      }
    }catch{failed=true;buffered=Buffer.alloc(0);onError();}
  };
}
