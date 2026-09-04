// 앱 톤에 맞춘 확인 창(모달)과 토스트 메시지.
//
// 브라우저 기본 confirm() 은 글꼴도 색도 앱과 따로 놀고, 문장을 길게 쓸수록
// 읽기 나빠진다. 화면 맨 위에 붙는 .msg 도 스크롤을 조금만 내리면 보이지 않는다.
// 그래서 둘 다 여기서 직접 그린다.
//
//   confirmDialog()  화면 가운데 뜨는 확인 창 — 예/아니오를 Promise 로 돌려준다
//   showToast()      화면 아래쪽에 잠깐 떴다 사라지는 알림 (탭바 위로 뜬다)
//
// 어느 페이지에서든 바로 쓸 수 있게, 필요한 요소는 이 파일이 스스로 만든다.

import { escapeHtml } from '/js/common.js';

/* ---------------- 확인 창 ---------------- */

/** 제목·본문을 이어 주는 aria 아이디가 겹치지 않게 하나씩 올려 쓴다 */
let dialogSeq = 0;

/**
 * 확인 창을 띄우고, 사용자가 고를 때까지 기다린다.
 * 확인을 누르면 true, 취소·ESC·바깥 누르기는 false.
 *
 * @param {object}  options
 * @param {string}  options.title       한 줄 제목 (필수)
 * @param {string} [options.message]    설명 문장
 * @param {string} [options.detail]     강조해서 따로 보여 줄 값 (예: "정답: 서울")
 * @param {string} [options.icon]       제목 위 이모지
 * @param {string} [options.confirmText] 확인 버튼 글자
 * @param {string} [options.cancelText]  취소 버튼 글자
 * @param {'default'|'danger'} [options.tone] danger 면 확인 버튼이 빨간색이 된다
 * @returns {Promise<boolean>}
 */
export function confirmDialog({
  title,
  message = '',
  detail = '',
  icon = '❔',
  confirmText = '확인',
  cancelText = '취소',
  tone = 'default',
} = {}) {
  const seq = ++dialogSeq;
  const titleId = `modal-title-${seq}`;
  const bodyId = `modal-body-${seq}`;

  const overlay = document.createElement('div');
  overlay.className = 'modal';
  overlay.innerHTML = `
    <div class="modal__sheet" role="alertdialog" aria-modal="true" aria-labelledby="${titleId}"
         ${message ? `aria-describedby="${bodyId}"` : ''}>
      <div class="modal__icon" aria-hidden="true">${escapeHtml(icon)}</div>
      <h2 class="modal__title" id="${titleId}">${escapeHtml(title)}</h2>
      ${message ? `<p class="modal__body" id="${bodyId}">${escapeHtml(message)}</p>` : ''}
      ${detail ? `<div class="modal__detail">${escapeHtml(detail)}</div>` : ''}
      <div class="btn-row modal__actions">
        <button class="btn btn--ghost" type="button" data-act="cancel">
          ${escapeHtml(cancelText)}
        </button>
        <button class="btn${tone === 'danger' ? ' btn--danger' : ''}" type="button" data-act="ok">
          ${escapeHtml(confirmText)}
        </button>
      </div>
    </div>`;

  const opener = document.activeElement;
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');

  const sheet = overlay.querySelector('.modal__sheet');
  const okButton = overlay.querySelector('[data-act="ok"]');
  const buttons = [...overlay.querySelectorAll('button')];
  okButton.focus();

  return new Promise((resolve) => {
    const close = (value) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      // 확인 창이 겹쳐 떠 있을 수도 있으니, 남은 게 없을 때만 스크롤을 풀어 준다
      if (!document.querySelector('.modal')) document.body.classList.remove('no-scroll');
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      resolve(value);
    };

    // 창이 떠 있는 동안 초점이 뒤 화면으로 새어 나가지 않게 Tab 을 안에서 돌린다
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        return close(false);
      }
      if (e.key !== 'Tab' || !sheet.contains(document.activeElement)) return;
      e.preventDefault();
      const at = buttons.indexOf(document.activeElement);
      const next = (at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next].focus();
    };
    document.addEventListener('keydown', onKey, true);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return close(false);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') close(false);
      if (act === 'ok') close(true);
    });
  });
}

/* ---------------- 토스트 ---------------- */

const TOAST_ICONS = { ok: '✅', error: '⚠️', info: '💬' };
/** 한 번에 이만큼만 쌓아 둔다 — 넘치면 오래된 것부터 치운다 */
const TOAST_MAX = 3;

let wrap = null;

function toastWrap() {
  if (wrap?.isConnected) return wrap;
  wrap = document.createElement('div');
  wrap.className = 'toast-wrap';
  // 탭바가 있는 화면에서는 탭바에 가리지 않게 그 위로 올린다
  if (document.querySelector('[data-tabbar]')) wrap.classList.add('toast-wrap--tabbar');
  wrap.setAttribute('role', 'status');
  wrap.setAttribute('aria-live', 'polite');
  document.body.appendChild(wrap);
  return wrap;
}

function dismiss(toast) {
  if (!toast.isConnected || toast.classList.contains('toast--out')) return;
  toast.classList.add('toast--out');
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
  // 애니메이션을 꺼 둔 기기(prefers-reduced-motion)에서도 확실히 사라지게 한다
  setTimeout(() => toast.remove(), 400);
}

/**
 * 화면 아래쪽에 알림을 잠깐 띄운다. 누르면 바로 사라진다.
 *
 * @param {string} text 보여 줄 문장
 * @param {'ok'|'error'|'info'} [kind]
 * @param {{duration?: number}} [options] 머무는 시간(ms). 기본값은 오류일 때 조금 더 길다.
 */
export function showToast(text, kind = 'ok', { duration } = {}) {
  const message = String(text ?? '').trim();
  if (!message) return null;

  const box = toastWrap();
  while (box.childElementCount >= TOAST_MAX) box.firstElementChild.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast--${kind}`;
  toast.innerHTML = `
    <span class="toast__icon" aria-hidden="true">${TOAST_ICONS[kind] ?? TOAST_ICONS.info}</span>
    <span class="toast__text">${escapeHtml(message)}</span>`;
  box.appendChild(toast);

  const timer = setTimeout(() => dismiss(toast), duration ?? (kind === 'error' ? 5000 : 3600));
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss(toast);
  });
  return toast;
}
