import { fail, json, personOf, readJson, requireAdmin } from '../lib/util.js';
import { GAMES, GAME_KEYS, gameInfo, gameOf } from '../lib/games.js';
import { QUIZ, getQuizTurn, quizInfo, setQuizTurnStatements } from '../lib/quiz.js';
import { assignSetterStatements, getSetters } from '../lib/setter.js';

/**
 * 출제자 후보(플레이어 전원)와 게임별로 지금 지정된 출제자.
 *
 * 예굼퀴즈대회의 출제자(= 출제 턴)도 여기서 함께 다룬다. 운영자가 처음 한 명을
 * 지정하면, 그다음부터는 가장 먼저 정답을 맞힌 사람에게 저절로 넘어간다.
 */
export async function onRequestGet(context) {
  const { response } = await requireAdmin(context);
  if (response) return response;

  const db = context.env.DB;
  const [{ results }, setters, quizTurn] = await Promise.all([
    db.prepare(
      `SELECT id, username, display_name, avatar, photo_version FROM users
        WHERE role = 'player' ORDER BY id`,
    ).all(),
    getSetters(db),
    getQuizTurn(db),
  ]);

  return json({
    ok: true,
    games: [...GAME_KEYS.map((key) => gameInfo(GAMES[key])), quizInfo()],
    setters: { ...setters, [QUIZ.key]: quizTurn },
    candidates: (results ?? []).map((u) =>
      personOf(u, {
        setterGames: [
          ...GAME_KEYS.filter((key) => setters[key]?.id === u.id),
          ...(quizTurn?.id === u.id ? [QUIZ.key] : []),
        ],
      }),
    ),
  });
}

/**
 * 한 게임의 출제자를 지정한다. 오전·오후는 이 사람의 시간이 정답이 되고,
 * 퀴즈는 이 사람이 다음 문제를 낼 차례가 된다.
 * 운영자는 게임에 참여하지 않으므로 출제자가 될 수 없다.
 */
export async function onRequestPost(context) {
  const { response } = await requireAdmin(context);
  if (response) return response;

  const body = await readJson(context.request);
  const isQuiz = String(body.game ?? '').trim() === QUIZ.key;
  const game = isQuiz ? QUIZ : gameOf(body.game);
  const userId = Number(body.userId ?? body.id);
  if (!Number.isInteger(userId)) return fail(400, '출제자로 지정할 참가자를 골라 주세요.');

  const db = context.env.DB;
  const target = await db.prepare(`SELECT id, role FROM users WHERE id = ?`).bind(userId).first();
  if (!target) return fail(404, '없는 계정입니다.');
  if (target.role === 'admin') return fail(400, '운영자는 출제자가 될 수 없습니다.');

  await db.batch(
    isQuiz ? setQuizTurnStatements(db, userId) : assignSetterStatements(db, game.key, userId),
  );

  const [setters, quizTurn] = await Promise.all([getSetters(db), getQuizTurn(db)]);

  return json({
    ok: true,
    game: isQuiz ? quizInfo() : gameInfo(game),
    setters: { ...setters, [QUIZ.key]: quizTurn },
  });
}
