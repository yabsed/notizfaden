import Dexie, { liveQuery, type Table } from 'dexie';
import { readable } from 'svelte/store';
import { newNote, uid, type LocalNote, type NoteBody } from './model';
class Notebook extends Dexie {
  notes!: Table<LocalNote, [string, string]>;
  settings!: Table<{ key: string; value: string }, string>;
  constructor() { super('teum-notebook'); this.version(1).stores({ notes: '[scope+id],scope', settings: 'key' }); }
}
export const db = new Notebook();
// An open editor retains its base revision until the user has finished.
export const activeEditors = new Set<string>();
export const editorKey = (scope: string, id: string) => `${scope}:${id}`;
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
      { title: '메모는 이렇게 써요', content: '카드를 누르면 바로 편집할 수 있어요.\n색을 바꾸고, 라벨을 붙이고,\n기억하고 싶은 메모는 고정해 두세요.\n\n이 시작 메모들도 자유롭게 바꾸거나 지울 수 있어요.', color: 'pink', labels: ['시작하기'] },
      { title: '', content: '아이디어는 정리하기 전에\n먼저 잡아두기.', color: 'purple', labels: ['생각'] },
      { title: '가벼운 메모장, 느슨한 연결', content: '내 노트에서 출발해서\n누군가의 새로운 생각이 되는 일.\n\n둘러보기에서 마음에 드는 메모를\n내 노트로 이어 써 보세요.', labels: ['생각'] },
    ];
    await db.notes.bulkPut(samples.map((body, i) => ({ ...newNote('guest'), body: { ...newNote('guest').body, ...body }, updatedAt: new Date(Date.now() - i * 60000).toISOString() })));
    await db.settings.put({ key: 'welcome', value: '1' });
  });
}
export function notesFor(scope: string) {
  return readable<{ notes: LocalNote[]; error: string }>({ notes: [], error: '' }, set => {
    const subscription = liveQuery(() => db.notes.where('scope').equals(scope).toArray()).subscribe({ next: notes => set({ notes, error: '' }), error: () => set({ notes: [], error: '기기에 메모를 저장할 수 없습니다. 저장 공간과 브라우저 설정을 확인해 주세요.' }) });
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
  await db.transaction('rw', db.notes, async () => {
    const guests = await db.notes.where('scope').equals('guest').toArray();
    for (const note of guests) {
      await db.notes.put({ ...newNote(scope), body: note.body });
    }
  });
}
