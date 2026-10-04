/* Offline rules and portable backup format. No network access. */
(function (root) {
  'use strict';
  const TYPES = {message: ['메시지','note'], link: ['링크','link'], photo: ['사진','image'], notice: ['공지','bell'], idea: ['아이디어','bulb']};
  const CATEGORIES = ['기타','생활','업무','학습','취미','건강','금융'];
  const RULES = [
    ['업무', ['회의','업무','프로젝트','회사','보고서','마감','미팅','클라이언트','출근','기획','계약'], ['업무','일정']],
    ['학습', ['공부','학습','강의','수업','책','독서','영어','자격증','개발','코딩','javascript','python','논문','튜토리얼'], ['학습','참고자료']],
    ['건강', ['운동','건강','병원','약국','진료','식단','헬스','수면','검진','러닝'], ['건강']],
    ['금융', ['은행','투자','주식','예금','보험','세금','납부','카드','가계부','적금','부동산'], ['금융']],
    ['취미', ['여행','영화','음악','게임','사진','전시','카페','맛집','공연','캠핑','취미'], ['취미']],
    ['생활', ['장보기','택배','주소','청소','구매','예약','이사','준비물','마트','생활','수리'], ['생활']]
  ];
  const normalize = text => String(text).normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g,' ').trim();
  function linksIn(text) {
    const candidates = String(text).match(/https?:\/\/[^\s<>"'\u0000-\u001f]+/gi) || [];
    const links = [];
    for (let raw of candidates) {
      raw = raw.replace(/[.,!?;，。]+$/u,'');
      while (raw.endsWith(')') && (raw.match(/\)/g)||[]).length > (raw.match(/\(/g)||[]).length) raw = raw.slice(0,-1);
      while (raw.endsWith(']') && (raw.match(/\]/g)||[]).length > (raw.match(/\[/g)||[]).length) raw = raw.slice(0,-1);
      try { const u = new URL(raw); if (/^https?:$/.test(u.protocol) && !u.username && !u.password && !links.includes(u.href)) links.push(u.href); } catch {}
    }
    return links.slice(0,30);
  }
  function classify(content, photos = []) {
    const text = normalize(content), urls = linksIn(content);
    let type = 'message';
    if (photos.length) type = 'photo';
    else if (urls.length) type = 'link';
    if (/(공지|안내문|모집|휴무|필독|공고|신청 기간|접수 기간)/u.test(text)) type = 'notice';
    else if (/(아이디어|생각난|떠오른|구상|해보면|해볼까|만들어보|기획안)/u.test(text)) type = 'idea';
    let category = '기타', score = 0, hits = [];
    for (const [field, keywords] of RULES) {
      const matches = keywords.filter(k=>text.includes(k));
      if (matches.length > score) {score = matches.length; category = field; hits = matches;}
    }
    let tags = [...String(content).matchAll(/#([\p{L}\p{N}_-]{1,30})/gu)].map(m=>m[1]);
    tags.push(...hits.slice(0,3));
    if (type === 'notice') tags.push('공지');
    if (type === 'idea') tags.push('아이디어');
    if (photos.length) tags.push('사진');
    if (urls.length) {try { tags.push(new URL(urls[0]).hostname.replace(/^www\./,'')); } catch {}}
    tags = [...new Set(tags)].slice(0,10);
    const lines = String(content).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    let title = lines.map(line => line.replace(/https?:\/\/\S+/gi,'').replace(/#[\p{L}\p{N}_-]+/gu,'').trim()).find(Boolean);
    if (!title) title = urls.length ? new URL(urls[0]).hostname.replace(/^www\./,'') : photos.length ? (photos[0].name.replace(/\.[^.]+$/,'') || '새 사진') : '새 기록';
    if (title.length > 56) title = title.slice(0,55) + '…';
    return {title, type, category, tags, urls};
  }
  function matches(record, query) {
    const terms = normalize(query).split(' ').filter(Boolean);
    const haystack = normalize([record.title,record.content,record.category,TYPES[record.type][0],...record.tags,...record.urls,...record.photos.map(p=>p.name)].join(' '));
    return terms.every(term=>haystack.includes(term));
  }
  const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  function validatePhoto(p) {
    if (!p || typeof p.name !== 'string' || p.name.length > 255 || typeof p.data !== 'string' || p.data.length > 28_000_000) throw new Error('지원하지 않거나 너무 큰 사진입니다.');
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/s.exec(p.data);
    if (!m || !m[2] || !B64.test(m[2])) throw new Error('사진 형식이 올바르지 않습니다.');
    const head = atob(m[2].slice(0,32));
    const valid = m[1]==='image/png' ? head.startsWith('\x89PNG\r\n\x1a\n') : m[1]==='image/jpeg' ? head.startsWith('\xff\xd8\xff') : m[1]==='image/gif' ? /^GIF8[79]a/.test(head) : head.startsWith('RIFF') && head.slice(8,12)==='WEBP';
    if (!valid) throw new Error('사진 내용과 파일 형식이 일치하지 않습니다.');
    return {name:p.name, data:p.data};
  }
  function validateBackup(backup) {
    if (!backup || backup.format !== 'info-drawer' || backup.version !== 1 || !Array.isArray(backup.records) || backup.records.length > 50000) throw new Error('정보 서랍 v1 백업 파일이 아닙니다.');
    const ids = new Set();
    const records = backup.records.map(r => {
      if (!r || typeof r.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(r.id) || ids.has(r.id)) throw new Error('기록 ID가 없거나 중복되었습니다.');
      ids.add(r.id);
      if (typeof r.title !== 'string' || !r.title.trim() || r.title.length > 200 || typeof r.content !== 'string' || r.content.length > 100000 || !Object.hasOwn(TYPES,r.type) || !CATEGORIES.includes(r.category)) throw new Error('기록의 제목, 내용 또는 분류가 올바르지 않습니다.');
      if (!Array.isArray(r.tags) || r.tags.length > 20 || r.tags.some(t=>typeof t !== 'string' || t.length>100) || !Array.isArray(r.photos) || r.photos.length > 20) throw new Error('태그 또는 사진 형식이 올바르지 않습니다.');
      if (typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt)) || typeof r.updatedAt !== 'string' || !Number.isFinite(Date.parse(r.updatedAt))) throw new Error('기록 날짜가 올바르지 않습니다.');
      return {id:r.id,title:r.title.trim(),content:r.content,type:r.type,category:r.category,tags:[...new Set(r.tags)],photos:r.photos.map(validatePhoto),urls:linksIn(r.content),favorite:r.favorite===true,createdAt:new Date(r.createdAt).toISOString(),updatedAt:new Date(r.updatedAt).toISOString()};
    });
    return records;
  }
  const makeBackup = records => ({format:'info-drawer',version:1,createdAt:new Date().toISOString(),records});
  function toBase64(bytes) {
    let str = ''; for(let i=0;i<bytes.length;i+=8192) str += String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(str);
  }
  function fromBase64(str, max) {
    if (typeof str !== 'string' || str.length > max || !B64.test(str)) throw new Error('암호화 백업 형식이 올바르지 않습니다.');
    return Uint8Array.from(atob(str),c=>c.charCodeAt(0));
  }
  async function keyFrom(password,salt,usage) {
    const base = await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,[usage]);
  }
  async function encryptBackup(backup,password) {
    if (password.length < 10) throw new Error('비밀번호는 10자 이상 입력하세요.');
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFrom(password,salt,'encrypt');
    const data = await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(backup)));
    return {format:'info-drawer-encrypted',version:1,kdf:'PBKDF2-SHA256',iterations:600000,cipher:'AES-256-GCM',salt:toBase64(salt),iv:toBase64(iv),data:toBase64(new Uint8Array(data))};
  }
  async function decryptBackup(envelope,password) {
    if (!envelope || envelope.format!=='info-drawer-encrypted' || envelope.version!==1 || envelope.kdf!=='PBKDF2-SHA256' || envelope.iterations!==600000 || envelope.cipher!=='AES-256-GCM') throw new Error('지원하지 않는 암호화 백업입니다.');
    if (!password) throw new Error('백업 비밀번호를 입력하세요.');
    const salt=fromBase64(envelope.salt,24),iv=fromBase64(envelope.iv,16),data=fromBase64(envelope.data,140_000_000);
    if (salt.length!==16 || iv.length!==12 || data.length<16) throw new Error('암호화 백업이 손상되었습니다.');
    const key=await keyFrom(password,salt,'decrypt');
    let plain;
    try {plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,data);} catch {throw new Error('비밀번호가 다르거나 백업 파일이 손상되었습니다.');}
    try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));} catch {throw new Error('백업 내용이 올바르지 않습니다.');}
  }
  const api={TYPES,CATEGORIES,normalize,linksIn,classify,matches,validatePhoto,validateBackup,makeBackup,encryptBackup,decryptBackup};
  root.DrawerCore=api;
  if(typeof module!=='undefined') module.exports=api;
})(globalThis);
