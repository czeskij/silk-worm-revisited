// Render the title music to a WAV: node music_wav.js ../chipmem.bin out.wav
const fs=require('fs');const m=require(__dirname+'/../../remake/js/music.js');
const mem=new Uint8Array(fs.readFileSync(process.argv[2]));
const s=m.load(mem,0);console.log(s.songLen,s.order.slice(0,s.songLen).join(','),s.inst.slice(1,7).map(i=>[i.ptr.toString(16),i.len,i.vol,i.rep,i.replen].join('/')),'arp',s.arp.length);
const t=Date.now();const r=m.render(mem,0,44100);console.log('secs',r.left.length/44100,'ms',Date.now()-t);
let peak=0;for(const v of r.left)peak=Math.max(peak,Math.abs(v));console.log('peak',peak);
const n=r.left.length,b=Buffer.alloc(44+n*4);b.write('RIFF',0);b.writeUInt32LE(36+n*4,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(176400,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*4,40);
for(let i=0;i<n;i++){b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,r.left[i]))*32767),44+i*4);b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,r.right[i]))*32767),46+i*4);}
fs.writeFileSync(process.argv[3],b);
