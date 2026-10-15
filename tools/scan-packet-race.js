const fs=require('fs'),rl=require('readline');const D='F:/Aion-Project/PL-AionMeter-ProtocolLab/DecodedFrames/';
const lab=JSON.parse(fs.readFileSync(process.env.TEMP+'/ak/labels.json'));
const files=fs.readdirSync(D).filter(f=>/^frames-202610(04-132010|09|11|12|13|14)[^]*\.ndjson$/.test(f)&&!/session|050204/.test(f));
const R={};const st={};
(async()=>{for(const f of files){const day=f.slice(11,15);const s=st[day]||(st[day]={fr:0,lab:0,ok:0,bad:0,o16:{}});const r=rl.createInterface({input:fs.createReadStream(D+f),crlfDelay:Infinity});
for await(const l of r){if(l.indexOf('"op":"0x0020"')<0||l.indexOf('S-\\u003EC')<0)continue;const b=Buffer.from(JSON.parse(l).hex,'hex');if(b.length<64)continue;
let e=51;while(e+1<b.length&&e<179&&(b[e]|b[e+1]))e+=2;const nm=b.toString('utf16le',51,e);if(!nm)continue;s.fr++;const v=b[37];
const x=R[nm]||(R[nm]={});x[day]=x[day]||{};x[day][v]=(x[day][v]||0)+1;const L=lab[nm];if(L===0||L===1){s.lab++;if(L===v)s.ok++;else s.bad++;}
const k=v+':'+b[16];s.o16[k]=(s.o16[k]||0)+1;}console.error('done',f);}
fs.writeFileSync(process.env.TEMP+'/ak/race0020.json',JSON.stringify(R));console.log(JSON.stringify(st));})();
