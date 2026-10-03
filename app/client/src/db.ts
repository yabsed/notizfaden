import { moveInOrder } from './reordering';
import Dexie, { liveQuery, type Table } from 'dexie';
import { readable } from 'svelte/store';
import { newNote, uid, type LocalNote, type NoteBody } from './model';
class Notebook extends Dexie {
  notes!: Table<LocalNote, [string, string]>;
  settings!: Table<{ key: string; value: string }, string>;
  constructor() { super('teum-notebook'); this.version(1).stores({ notes: '[scope+id],scope', settings: 'key' }); }
}
export const db = new Notebook();
export interface LocalOrder { ids: string[]; dirty: boolean; mutationId: string }
export const orderKey = (scope: string) => `note-order:${scope}`;
export async function readOrder(scope: string): Promise<LocalOrder> {
  const row = await db.settings.get(orderKey(scope));
  return row ? JSON.parse(row.value) : { ids: [], dirty: false, mutationId: '' };
}
export async function writeOrder(scope: string, order: LocalOrder) {
  await db.settings.put({ key: orderKey(scope), value: JSON.stringify(order) });
}
export function orderedNotes(notes: LocalNote[], ids: string[]) {
  const positions = new Map(ids.map((id, index) => [id, index]));
  // Newly created/imported notes start above the saved arrangement. Edits to an
  // already arranged note do not make the card jump back to the top.
  return [...notes].sort((a, b) => {
    const left = positions.get(a.id), right = positions.get(b.id);
    if (left !== undefined && right !== undefined) return left - right;
    if (left !== undefined) return 1;
    if (right !== undefined) return -1;
    return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  });
}
export async function moveNote(scope: string, id: string, target: string, path?: string[]) {
  if (id === target) return false;
  return db.transaction('rw', db.notes, db.settings, async () => {
    const notes = await db.notes.where('scope').equals(scope).toArray();
    const source = notes.find(n => n.id === id), destination = notes.find(n => n.id === target);
    if (!source || !destination || source.body.trashed || destination.body.trashed || source.body.pinned !== destination.body.pinned) return false;
    const order = await readOrder(scope);
    const previous = orderedNotes(notes, order.ids).map(n => n.id);
    const eligible = new Set(notes.filter(note => !note.body.trashed && note.body.pinned === source.body.pinned).map(note => note.id));
    if (path?.some(value => !eligible.has(value))) return false;
    const ids = moveInOrder(previous, id, target, path);
    if (ids.every((value, index) => value === previous[index])) return false;
    await writeOrder(scope, { ids, dirty: true, mutationId: uid() });
    return true;
  });
}
const welcomeContent = '완성된 글이 아니어도 괜찮아요.\n떠오른 생각을 여기 남겨두세요.\n\n모든 메모는 나만 보는 것으로 시작해요. 함께 나누고 싶은 날, 공개 범위만 바꾸면 돼요.';
export async function seed() {
  await db.transaction('rw', db.notes, db.settings, async () => {
    if (!await db.settings.get('brand-notizfaden')) {
      const legacyWelcome = await db.notes.filter(note => note.body.title === '작은 생각을 위한 작은 틈' && note.body.content === welcomeContent).toArray();
      await db.notes.bulkPut(legacyWelcome.map(note => ({ ...note, body: { ...note.body, title: 'Notizfaden에 오신 걸 환영해요' }, updatedAt: new Date().toISOString(), dirty: true, mutationId: uid() })));
      await db.settings.put({ key: 'brand-notizfaden', value: '1' });
    }
    if (await db.settings.get('welcome')) return;
    const samples: Partial<NoteBody>[] = [
      { title: 'Notizfaden에 오신 걸 환영해요', content: welcomeContent, color: 'yellow', pinned: true, labels: ['시작하기'] },
      { title: '오늘의 작은 할 일', kind: 'checklist', items: ['물 한 잔 마시기', '읽던 책 10쪽', '생각 하나 적어두기', '저녁에 동네 한 바퀴'].map((text, i) => ({ id: uid(), text, done: i === 0 })), pinned: true, labels: ['일상'] },
      { title: '아직 답을 모르는 질문', content: '우리는 왜 이미 알고 있는 것을\n굳이 글로 적는 걸까?\n\n적는 동안 조금 다른 생각이\n되기 때문일지도.', color: 'lightblue', labels: ['생각'] },
      { title: '읽다가 멈춘 문장', content: '천천히 생각해도 괜찮다.\n적어둔 문장은 나를 기다려주니까.\n\n오늘의 나에게 남기는 말.', color: 'default', labels: ['문장'] },
      { title: '주말에는', content: '휴대폰 두고 산책하기\n동네 작은 서점 들르기\n새로운 커피 마셔보기', color: 'green', labels: ['일상'] },
      { title: '메모는 이렇게 써요', content: '카드를 누르면 자세히 볼 수 있어요.\n열린 메모의 글자를 누르면 편집해요.\n색을 바꾸고, 태그를 붙이고,\n기억하고 싶은 메모는 고정해 두세요.\n\n이 시작 메모들도 자유롭게 바꾸거나 지울 수 있어요.', color: 'pink', labels: ['시작하기'] },
      { title: '', content: '아이디어는 정리하기 전에\n먼저 잡아두기.', color: 'purple', labels: ['생각'] },
      { title: '가벼운 메모장, 느슨한 연결', content: '내 노트에서 출발해서\n누군가의 새로운 생각이 되는 일.\n\n둘러보기에서 마음에 드는 메모를\n내 노트로 이어 써 보세요.', labels: ['생각'] },
    ];
    await db.notes.bulkPut(samples.map((body, i) => ({ ...newNote('guest'), body: { ...newNote('guest').body, ...body }, updatedAt: new Date(Date.now() - i * 60000).toISOString() })));
    await db.settings.put({ key: 'welcome', value: '1' });
  });
}
export function notesFor(scope: string) {
  const empty = { notes: [] as LocalNote[], order: { ids: [], dirty: false, mutationId: '' } as LocalOrder, error: '' };
  return readable(empty, set => {
    const subscription = liveQuery(async () => ({ notes: await db.notes.where('scope').equals(scope).toArray(), order: await readOrder(scope), error: '' })).subscribe({ next: set, error: () => set({ ...empty, error: '기기에 메모를 저장할 수 없습니다. 저장 공간과 브라우저 설정을 확인해 주세요.' }) });
    return () => subscription.unsubscribe();
  });
}
// Each edit commits immediately. Reading within the transaction prevents an
// in-flight sync acknowledgement from resetting the next edit's revision.
export async function persist(note: LocalNote, body: NoteBody) {
  await db.transaction('rw', db.notes, async () => {
    const latest = await db.notes.get([note.scope, note.id]);
    await db.notes.put({ ...note, ...latest, body, updatedAt: new Date().toISOString(), dirty: true, mutationId: uid(), syncError: undefined });
  });
}
export async function importGuest(scope: string) {
  await db.transaction('rw', db.notes, db.settings, async () => {
    const guestOrder = await readOrder('guest'), order = await readOrder(scope);
    const guests = orderedNotes(await db.notes.where('scope').equals('guest').toArray(), guestOrder.ids);
    const imported: string[] = [];
    for (const note of guests) {
      const copy = { ...newNote(scope), body: note.body };
      await db.notes.put(copy); imported.push(copy.id);
    }
    if (imported.length) await writeOrder(scope, { ids: [...imported, ...order.ids], dirty: true, mutationId: uid() });
  });
}
