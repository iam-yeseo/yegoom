// 앨범에서 고른 사진을 정방형으로 잘라 주는 화면.
//
// 사진은 대부분 정방형이 아니라 그냥 가운데를 자르면 얼굴이 잘려 나간다.
// 그래서 정사각형 창을 띄워 놓고 사진을 끌어 옮기거나(드래그) 확대·축소해서
// 담을 부분을 직접 고르게 한다. 창 밖으로는 나갈 수 없으므로 결과는 항상
// 빈틈 없는 정방형이다.
//
//   const dataUrl = await pickSquarePhoto(file);   // 취소하면 null
//
// 퀴즈 문제에 붙이는 사진은 비율을 가리지 않으므로 자르기 창 없이 크기만 줄인다.
//
//   const dataUrl = await shrinkPhoto(file);

/** 저장할 사진 한 변의 길이(px). 프로필 칸은 작지만 고해상도 화면을 감안했다. */
const OUTPUT_SIZE = 512;
/** 서버가 받아 주는 최대 용량(바이트)보다 넉넉히 아래로 맞춘다. */
const MAX_BYTES = 260 * 1024;
/** 원본이 너무 크면 브라우저가 힘들어하므로 미리 줄여서 다룬다. */
const MAX_SOURCE_SIDE = 2048;

/** 퀴즈 문제에 붙이는 사진 — 긴 변 기준. 서버가 받아 주는 한도보다 넉넉히 아래다. */
const WIDE_MAX_SIDE = 1280;
const WIDE_MAX_BYTES = 440 * 1024;

/** 파일을 그림으로 읽는다. 아이폰 사진의 회전 정보(EXIF)도 반영한다. */
async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* 옵션을 모르는 브라우저는 아래로 내려간다 */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('사진을 읽지 못했어요.'));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

const sizeOf = (img) => ({
  width: img.naturalWidth ?? img.width,
  height: img.naturalHeight ?? img.height,
});

/** 캔버스를 용량 안에 들어오는 JPEG data URL 로 만든다. */
function toDataUrl(canvas, maxBytes = MAX_BYTES) {
  for (const quality of [0.86, 0.78, 0.7, 0.6, 0.5]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    // base64 는 원본의 약 4/3 이라 길이로 용량을 가늠할 수 있다
    if ((url.length - url.indexOf(',') - 1) * 0.75 <= maxBytes) return url;
  }
  return canvas.toDataURL('image/jpeg', 0.4);
}

/** 앨범에서 고른 파일이 쓸 만한지 먼저 본다 (두 고르기 함수가 함께 쓴다) */
function checkFile(file) {
  if (!/^image\//.test(file.type)) throw new Error('사진 파일만 고를 수 있어요.');
  if (file.size > 30 * 1024 * 1024) throw new Error('사진이 너무 큽니다. 30MB 이하로 골라 주세요.');
}

/**
 * 자르지 않고 크기만 줄여 data URL 로 돌려준다 (퀴즈 문제에 붙이는 사진).
 * 가로세로 비율은 그대로 두고, 긴 변만 한도 안으로 맞춘다.
 */
export async function shrinkPhoto(file, { maxSide = WIDE_MAX_SIDE, maxBytes = WIDE_MAX_BYTES } = {}) {
  if (!file) return null;
  checkFile(file);

  const image = await loadImage(file);
  const source = sizeOf(image);
  if (!source.width || !source.height) throw new Error('사진을 읽지 못했어요.');

  const k = Math.min(1, maxSide / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * k));
  const height = Math.max(1, Math.round(source.height * k));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // JPEG 은 투명을 모르므로 밑색을 깔아 둔다
  ctx.fillStyle = '#151a30';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  try {
    return toDataUrl(canvas, maxBytes);
  } finally {
    image.close?.();          // ImageBitmap 은 직접 닫아 준다
  }
}

/**
 * 자르기 창을 띄우고, 사용자가 고른 정방형 영역을 data URL 로 돌려준다.
 * 취소하면 null.
 */
export async function pickSquarePhoto(file) {
  if (!file) return null;
  checkFile(file);

  const image = await loadImage(file);
  const source = sizeOf(image);
  if (!source.width || !source.height) throw new Error('사진을 읽지 못했어요.');

  const overlay = document.createElement('div');
  overlay.className = 'cropper';
  overlay.innerHTML = `
    <div class="cropper__sheet" role="dialog" aria-modal="true" aria-label="프로필 사진 자르기">
      <div class="cropper__title">정방형으로 자르기</div>
      <div class="cropper__stage">
        <canvas class="cropper__canvas"></canvas>
        <div class="cropper__mask" aria-hidden="true"></div>
      </div>
      <label class="cropper__zoom">
        <span>확대</span>
        <input type="range" min="100" max="400" value="100" aria-label="확대 정도" />
      </label>
      <p class="cropper__hint">사진을 끌어 옮기고, 확대해서 넣을 부분을 고르세요.</p>
      <div class="btn-row">
        <button class="btn btn--ghost" type="button" data-act="cancel">취소</button>
        <button class="btn" type="button" data-act="apply">이 부분으로</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');

  const canvas = overlay.querySelector('.cropper__canvas');
  const zoomInput = overlay.querySelector('input[type="range"]');
  const ctx = canvas.getContext('2d');

  // 정사각형 창의 한 변 (화면 폭에 맞춰 줄어든다)
  const viewport = Math.round(Math.min(320, window.innerWidth - 76, window.innerHeight - 300));
  const side = Math.max(200, viewport);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${side}px`;
  canvas.style.height = `${side}px`;
  canvas.width = Math.round(side * dpr);
  canvas.height = Math.round(side * dpr);

  // 짧은 변이 창을 꽉 채우는 배율이 최소 배율이다 (더 줄이면 빈틈이 생긴다)
  const coverScale = side / Math.min(source.width, source.height);
  let zoom = 1;
  let offsetX = (side - source.width * coverScale) / 2;
  let offsetY = (side - source.height * coverScale) / 2;

  const scale = () => coverScale * zoom;

  /** 사진이 창을 늘 덮도록 이동 범위를 가둔다 */
  function clamp() {
    const w = source.width * scale();
    const h = source.height * scale();
    offsetX = Math.min(0, Math.max(side - w, offsetX));
    offsetY = Math.min(0, Math.max(side - h, offsetY));
  }

  function draw() {
    clamp();
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, side, side);
    ctx.drawImage(image, offsetX, offsetY, source.width * scale(), source.height * scale());
    ctx.restore();
  }

  /** 창 가운데를 기준으로 배율을 바꾼다 (보고 있던 부분이 그대로 남는다) */
  function setZoom(next, anchorX = side / 2, anchorY = side / 2) {
    const before = scale();
    zoom = Math.min(4, Math.max(1, next));
    const ratio = scale() / before;
    offsetX = anchorX - (anchorX - offsetX) * ratio;
    offsetY = anchorY - (anchorY - offsetY) * ratio;
    zoomInput.value = String(Math.round(zoom * 100));
    draw();
  }

  /* ---- 끌어 옮기기 + 손가락 두 개로 확대 ---- */
  const pointers = new Map();
  let pinchStart = null;

  const localPoint = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const middle = () => {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, localPoint(e));
    if (pointers.size === 2) pinchStart = { distance: spread(), zoom };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    e.preventDefault();
    const prev = pointers.get(e.pointerId);
    const next = localPoint(e);
    pointers.set(e.pointerId, next);

    if (pointers.size >= 2 && pinchStart) {
      const center = middle();
      setZoom((pinchStart.zoom * spread()) / pinchStart.distance, center.x, center.y);
      return;
    }
    offsetX += next.x - prev.x;
    offsetY += next.y - prev.y;
    draw();
  });

  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const at = localPoint(e);
    setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), at.x, at.y);
  }, { passive: false });

  zoomInput.addEventListener('input', () => setZoom(Number(zoomInput.value) / 100));

  draw();

  /** 창에 보이는 부분만 정방형 캔버스로 옮겨 담는다 */
  function crop() {
    const out = document.createElement('canvas');
    out.width = OUTPUT_SIZE;
    out.height = OUTPUT_SIZE;
    const outCtx = out.getContext('2d');
    outCtx.imageSmoothingQuality = 'high';
    // JPEG 은 투명을 모르므로 밑색을 깔아 둔다
    outCtx.fillStyle = '#151a30';
    outCtx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    const k = scale();
    const sourceSide = Math.min(side / k, Math.min(source.width, source.height));
    outCtx.drawImage(
      image,
      -offsetX / k, -offsetY / k, sourceSide, sourceSide,
      0, 0, OUTPUT_SIZE, OUTPUT_SIZE,
    );
    return toDataUrl(out);
  }

  return new Promise((resolve) => {
    const close = (value) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      document.body.classList.remove('no-scroll');
      image.close?.();          // ImageBitmap 은 직접 닫아 준다
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return close(null);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') close(null);
      if (act === 'apply') close(crop());
    });
  });
}
