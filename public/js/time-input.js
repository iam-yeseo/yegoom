// 시 · 분 · 초를 직접 찍어 넣는 입력칸.
//
// 원래는 <input type="time" step="1"> 을 썼지만, 모바일 브라우저가 띄우는 시계형
// 선택기는 초를 아예 못 고르거나(안드로이드 크롬) 굴리기 힘든 휠로만 준다(iOS).
// 초까지 맞히는 게임이라 초를 못 고르면 게임이 안 되므로, 숫자 키패드가 뜨는
// 칸 세 개로 바꿨다. 데스크톱에서도 그대로 숫자를 치면 된다.
//
//   createTimeInput(host, { value: '18:00:00', onChange })
//     .value      "HH:MM:SS" (비어 있으면 null)
//     .focus()    첫 칸에 커서

const PARTS = [
  { key: 'h', max: 23, label: '시' },
  { key: 'm', max: 59, label: '분' },
  { key: 's', max: 59, label: '초' },
];

const pad2 = (n) => String(n).padStart(2, '0');

/** "18:00:30" -> ['18','00','30'] · 형식이 틀리면 null */
function splitTime(value) {
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const nums = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (nums.some((n) => Number.isNaN(n))) return null;
  return nums.map((n, i) => pad2(Math.min(n, PARTS[i].max)));
}

/**
 * host 안에 시:분:초 입력칸을 만든다.
 * @param {HTMLElement} host
 * @param {{ value?: string, onChange?: (value: string|null) => void, label?: string }} options
 */
export function createTimeInput(host, { value = '', onChange, label = '시간' } = {}) {
  host.classList.add('time-input');
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', `${label} (시 · 분 · 초)`);

  // maxlength 를 걸지 않는 이유: 두 자리를 채운 칸에 숫자를 더 쳤을 때
  // 브라우저가 입력 자체를 막아 버려서 "새로 입력" 으로 받아 줄 수가 없다.
  // 자릿수는 아래 input 처리에서 자른다.
  host.innerHTML = PARTS.map(
    (p, i) =>
      `${i ? '<span class="time-input__colon" aria-hidden="true">:</span>' : ''}
       <span class="time-input__slot">
         <input class="time-input__field" data-part="${p.key}" type="text"
                inputmode="numeric" pattern="[0-9]*" autocomplete="off"
                enterkeyhint="next" aria-label="${p.label}" placeholder="00" />
         <span class="time-input__unit" aria-hidden="true">${p.label}</span>
       </span>`,
  ).join('');

  const fields = [...host.querySelectorAll('.time-input__field')];

  const emit = () => onChange?.(read());

  /** 지금 값 — 한 칸이라도 채워져 있으면 빈 칸은 00 으로 본다 */
  function read() {
    const raw = fields.map((f) => f.value.replace(/\D/g, ''));
    if (raw.every((v) => v === '')) return null;
    return raw.map((v, i) => pad2(Math.min(Number(v || 0), PARTS[i].max))).join(':');
  }

  function write(next) {
    const parts = splitTime(next);
    fields.forEach((f, i) => { f.value = parts ? parts[i] : ''; });
  }

  /** 칸을 벗어날 때 두 자리로 채워 놓는다 (빈 칸은 그대로 둔다) */
  function normalize(field, index) {
    const digits = field.value.replace(/\D/g, '');
    if (!digits) { field.value = ''; return; }
    field.value = pad2(Math.min(Number(digits), PARTS[index].max));
  }

  function focusField(index, { select = true } = {}) {
    const field = fields[index];
    if (!field) return;
    field.focus();
    if (select) field.select();
  }

  fields.forEach((field, index) => {
    const part = PARTS[index];

    field.addEventListener('focus', () => field.select());

    field.addEventListener('input', () => {
      const typed = field.value.replace(/\D/g, '');
      // 이미 두 자리를 채운 칸에 숫자를 더 치면 새로 입력하는 것으로 본다.
      // (마지막 칸은 다음 칸으로 넘어가지 않으므로 안 그러면 눌러도 반응이 없다)
      const digits = typed.length > 2 ? typed.slice(-1) : typed;
      field.value = digits;

      // 두 자리를 채웠거나, 첫 숫자만으로 최대값을 넘길 수밖에 없으면 다음 칸으로
      const firstDigitFinal = digits.length === 1 && Number(digits) * 10 > part.max;
      if (digits.length === 2 || firstDigitFinal) {
        normalize(field, index);
        if (index < fields.length - 1) focusField(index + 1);
      }
      emit();
    });

    field.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !field.value && index > 0) {
        e.preventDefault();
        focusField(index - 1);
        return;
      }
      if (e.key === 'ArrowLeft' && field.selectionStart === 0 && index > 0) {
        e.preventDefault();
        focusField(index - 1);
        return;
      }
      if (e.key === 'ArrowRight' && field.selectionEnd === field.value.length &&
          index < fields.length - 1) {
        e.preventDefault();
        focusField(index + 1);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = e.key === 'ArrowUp' ? 1 : -1;
        const current = Number(field.value.replace(/\D/g, '') || 0);
        const span = part.max + 1;
        field.value = pad2(((current + step) % span + span) % span);
        field.select();
        emit();
      }
    });

    // "18:00:30" 를 통째로 붙여 넣으면 세 칸에 나눠 담는다
    field.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text') ?? '';
      if (!splitTime(text)) return;
      e.preventDefault();
      write(text);
      focusField(fields.length - 1, { select: false });
      emit();
    });

    field.addEventListener('blur', () => {
      normalize(field, index);
      emit();
    });
  });

  write(value);

  return {
    element: host,
    fields,
    get value() { return read(); },
    set value(next) { write(next); emit(); },
    focus() { focusField(0); },
    setDisabled(disabled) {
      for (const f of fields) f.disabled = disabled;
      host.classList.toggle('time-input--disabled', disabled);
    },
  };
}
