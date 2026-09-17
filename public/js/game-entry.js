// 역할에 맞는 화면만 로드한다. 운영자는 게임 입력/참여 화면을 만들지 않는다.
import { requireLogin, showMessage } from './common.js';

try {
  const user = await requireLogin();
  const game = document.body.dataset.game ?? document.body.dataset.party;
  if (user.role === 'admin') {
    const { mountAdminGame } = await import('./admin-game-page.js');
    await mountAdminGame(user, game);
  } else if (game === 'morning' || game === 'evening') {
    await import('./game-page.js');
  } else if (game === 'quiz') {
    await import('./quiz-page.js');
  } else {
    await import('./party-page.js');
  }
} catch (err) {
  const message = document.createElement('p');
  document.querySelector('.app').prepend(message);
  showMessage(message, `화면을 불러오지 못했습니다: ${err.message}`);
}
