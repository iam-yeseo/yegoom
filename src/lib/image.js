// 사진 검사 — 브라우저가 보낸 data URL 을 뜯어 쓸 수 있는 이미지인지 확인한다.
//
// 줄이고 자르는 일은 브라우저에서 하지만, 화면을 거치지 않고 API 를 직접 부를 수도
// 있으므로 서버에서도 같은 규칙을 다시 확인한다. Workers 에는 이미지 디코더가 없어서
// 파일 앞머리(헤더)만 읽어 실제 형식과 가로·세로를 알아낸다.
//
// 프로필 사진은 정방형만 받고(normalizePhoto), 퀴즈 문제에 붙는 사진은 비율을
// 가리지 않는다(normalizeQuizPhoto). 나머지 규칙은 똑같다.

/** 브라우저가 만드는 것과 같은 형식만 받는다. */
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** 사진 한 변의 최대 길이(px). 화면에서는 512 로 줄여 보내므로 넉넉하다. */
export const MAX_PHOTO_SIDE = 1024;
/** 사진 한 변의 최소 길이(px) — 너무 흐린 사진을 막는다. */
export const MIN_PHOTO_SIDE = 64;
/** 저장할 수 있는 최대 용량(바이트). base64 로는 약 1.34배가 된다. */
export const MAX_PHOTO_BYTES = 300 * 1024;

/** 퀴즈 문제에 붙는 사진 — 글과 함께 보는 그림이라 조금 더 크게 받는다. */
export const MAX_QUIZ_PHOTO_SIDE = 1600;
export const MAX_QUIZ_PHOTO_BYTES = 500 * 1024;

/** "data:image/jpeg;base64,...." 에서 mime 과 base64 본문을 떼어 낸다. */
function splitDataUrl(value) {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(value ?? ''));
  if (!m) return null;
  return { mime: m[1].toLowerCase(), base64: m[2].replace(/\s+/g, '') };
}

function decodeBase64(base64) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

function startsWith(bytes, signature, offset = 0) {
  return signature.every((v, i) => bytes[offset + i] === v);
}

/** PNG — IHDR 이 항상 맨 앞에 오므로 고정 위치에서 읽으면 된다. */
function readPng(bytes) {
  if (!startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  if (bytes.length < 24) return null;
  return { mime: 'image/png', width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

/** JPEG — 세그먼트를 따라가다 크기를 담고 있는 SOF 마커에서 멈춘다. */
function readJpeg(bytes) {
  if (!startsWith(bytes, [0xff, 0xd8, 0xff])) return null;

  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }          // 채움 바이트는 건너뛴다
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xda || marker === 0xd9) break;      // 여기부터는 압축된 그림 데이터

    const length = u16be(bytes, i + 2);
    if (length < 2) return null;
    // SOF0~SOF15 가 크기를 갖고 있다 (DHT 0xc4 · JPG 0xc8 · DAC 0xcc 는 제외)
    const isSof = marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { mime: 'image/jpeg', height: u16be(bytes, i + 5), width: u16be(bytes, i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

/** WebP — 손실(VP8) · 무손실(VP8L) · 확장(VP8X) 세 가지 모두 헤더 모양이 다르다. */
function readWebp(bytes) {
  if (!startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) ||          // "RIFF"
      !startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return null;  // "WEBP"
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);

  if (chunk === 'VP8 ') return readLossyWebp(bytes);
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return {
      mime: 'image/webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return { mime: 'image/webp', width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  }
  return null;
}

/** 손실 WebP 는 리틀엔디언이라 위 공식이 헷갈리기 쉬워 따로 계산한다. */
function readLossyWebp(bytes) {
  if (bytes.length < 30) return null;
  if (!(bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)) return null; // 동기화 코드
  return {
    mime: 'image/webp',
    width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
    height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
  };
}

/** 실제 바이트에서 형식과 크기를 읽는다. 알 수 없으면 null */
export function readImageMeta(bytes) {
  if (!bytes || bytes.length < 24) return null;
  return readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes);
}

/**
 * 사진으로 쓸 수 있는지 확인한다.
 * 확장자나 헤더에 적힌 형식이 아니라 실제 바이트를 보고 판단한다.
 *
 * @param {string} input  "data:image/jpeg;base64,..." 모양의 문자열
 * @param {{ square?: boolean, maxBytes?: number, maxSide?: number, minSide?: number }} [options]
 *        square 를 끄면 비율을 가리지 않는다 (퀴즈 문제 사진).
 * @returns {{ mime: string, base64: string, size: number, width: number, height: number }
 *           | { error: string }}
 */
export function normalizeImage(input, options = {}) {
  const {
    square = true,
    maxBytes = MAX_PHOTO_BYTES,
    maxSide = MAX_PHOTO_SIDE,
    minSide = MIN_PHOTO_SIDE,
  } = options;

  const parts = splitDataUrl(input);
  if (!parts) return { error: '사진을 읽지 못했어요. 다시 골라 주세요.' };

  const bytes = decodeBase64(parts.base64);
  if (!bytes || !bytes.length) return { error: '사진을 읽지 못했어요. 다시 골라 주세요.' };
  if (bytes.length > maxBytes) {
    return { error: `사진이 너무 큽니다. ${Math.floor(maxBytes / 1024)}KB 이하로 올려 주세요.` };
  }

  const meta = readImageMeta(bytes);
  if (!meta || !ALLOWED.has(meta.mime)) {
    return { error: 'JPG · PNG · WebP 사진만 올릴 수 있어요.' };
  }
  // 적어 보낸 형식과 실제 바이트가 다르면 받지 않는다
  if (parts.mime !== meta.mime) return { error: '사진 형식을 확인하지 못했어요.' };

  const { width, height } = meta;
  if (!width || !height) return { error: '사진 크기를 확인하지 못했어요.' };
  if (square && width !== height) {
    return { error: '프로필 사진은 정방형(1:1)으로만 넣을 수 있어요.' };
  }
  if (Math.min(width, height) < minSide) {
    return { error: `사진이 너무 작아요. ${minSide}px 이상이어야 해요.` };
  }
  if (Math.max(width, height) > maxSide) {
    return { error: `사진이 너무 커요. ${maxSide}px 이하로 줄여 주세요.` };
  }

  return { mime: meta.mime, base64: parts.base64, size: bytes.length, width, height };
}

/** 프로필 사진 — 정방형만 받는다 */
export function normalizePhoto(input) {
  return normalizeImage(input, { square: true });
}

/** 퀴즈 문제에 붙는 사진 — 비율은 가리지 않고, 조금 더 큰 것까지 받는다 */
export function normalizeQuizPhoto(input) {
  return normalizeImage(input, {
    square: false,
    maxBytes: MAX_QUIZ_PHOTO_BYTES,
    maxSide: MAX_QUIZ_PHOTO_SIDE,
    minSide: 32,
  });
}
