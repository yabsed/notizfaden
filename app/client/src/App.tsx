import { useCallback, useEffect, useRef, useState } from 'react';
import { Menu, Search, Lightbulb, Compass, Archive, Trash2, Tag, LayoutGrid, Rows3, Moon, Sun, Cloud, CloudOff, RefreshCw, Plus, CheckSquare, X, Download, LogOut, LockKeyhole, Check, ArrowRight, AlertCircle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { activeEditors, editorKey, db, importGuest, persist, seed, useNotes } from './db';
import { changeVisibility, errorMessage, preserveConflict, request, sync } from './api';
import { hasContent, newNote, type Kind, type LocalNote, type Note, type NoteBody, type Session } from './model';
import { AuthDialog, Editor, IconButton, Modal, NoteCard, PublicReader } from './components';

function stored<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
type View = 'notes' | 'explore' | 'archive' | 'trash' | `label:${string}`;

export default function App() {
  const [session, setSession] = useState<Session | null>(() => stored('teum-session', null));
  const scope = session?.user.id || 'guest';
  const { notes, error: storageError } = useNotes(scope);
  const [view, setView] = useState<View>('notes');
  const [query, setQuery] = useState('');
  const [sidebar, setSidebar] = useState(window.innerWidth > 900);
  const [list, setList] = useState(() => stored('teum-list', false));
  const [dark, setDark] = useState(() => stored('teum-dark', false));
  const [editor, setEditor] = useState<LocalNote | null>(null);
  const [reader, setReader] = useState<Note | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [feed, setFeed] = useState<Note[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [toast, setToast] = useState('');
  const [initError, setInitError] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const editorCurrent = editor ? notes.find(n => n.id === editor.id) || editor : null;
  const labels = [...new Set(notes.filter(n => !n.body.trashed).flatMap(n => n.body.labels))].sort();
  const notify = useCallback((text: string) => setToast(text), []);

  useEffect(() => { if (!editor) return; const key = editorKey(editor.scope, editor.id); activeEditors.add(key); return () => { activeEditors.delete(key); }; }, [editor]);
  useEffect(() => { seed().catch(() => setInitError('기기 저장소를 열지 못했어요. 브라우저의 저장 공간을 확인해 주세요.')); }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('teum-dark', JSON.stringify(dark)); }, [dark]);
  useEffect(() => { localStorage.setItem('teum-list', JSON.stringify(list)); }, [list]);
  useEffect(() => { const changed = (e: StorageEvent) => { if (e.key === 'teum-session') { setSession(stored('teum-session', null)); setEditor(null); setAccountOpen(false); } }; window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4500); return () => clearTimeout(t); }, [toast]);

  const doSync = useCallback(async (silent = false) => {
    if (!session) { if (!silent) notify('메모는 이 기기에 저장됩니다. 로그인하면 기기 간 동기화할 수 있어요.'); return; }
    setSyncing(true);
    try { await sync(session); setSyncError(''); } catch (e) { setSyncError(errorMessage(e)); if (!silent) notify(errorMessage(e)); } finally { setSyncing(false); }
  }, [session, notify]);
  useEffect(() => {
    if (!session || editor) return;
    const go = () => void doSync(true);
    go(); const timer = setInterval(go, 15000);
    window.addEventListener('online', go); window.addEventListener('focus', go);
    return () => { clearInterval(timer); window.removeEventListener('online', go); window.removeEventListener('focus', go); };
  }, [session, editor, doSync]);
  const pending = notes.filter(n => n.dirty && !n.conflict && !n.syncError).length;
  useEffect(() => { if (!session || editor || pending === 0) return; const t = setTimeout(() => void doSync(true), 800); return () => clearTimeout(t); }, [session, editor, pending, notes, doSync]);

  const loadFeed = useCallback(async () => {
    setFeedLoading(true);
    try { const latest = await request<Note[]>('/public'); setFeed(latest); setFeedError(''); }
    catch { setFeed([]); setFeedError('공개 메모를 불러오지 못했어요. 서버 연결을 확인해 주세요.'); }
    finally { setFeedLoading(false); }
  }, []);
  useEffect(() => {
    if (view !== 'explore') return;
    void loadFeed(); const t = setInterval(() => void loadFeed(), 15000);
    return () => clearInterval(t);
  }, [view, loadFeed]);
  const readPublic = useCallback(async (id: string) => {
    try { setReader(await request<Note>(`/public/${id}`)); }
    catch { setReader(null); setFeed(f => f.filter(n => n.id !== id)); notify('더 이상 공개되지 않은 메모입니다.'); }
  }, [notify]);
  useEffect(() => {
    const fromLink = () => { const id = new URLSearchParams(location.search).get('note'); if (id) void readPublic(id); };
    fromLink(); window.addEventListener('popstate', fromLink);
    return () => window.removeEventListener('popstate', fromLink);
  }, [readPublic]);
  useEffect(() => {
    if (!reader) return;
    const timer = setInterval(async () => { try { setReader(await request<Note>(`/public/${reader.id}`)); } catch { setReader(null); notify('공개 메모를 더 이상 열람할 수 없습니다.'); } }, 15000);
    return () => clearInterval(timer);
  }, [reader?.id, notify]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener('backButton', () => { if (reader) setReader(null); else if (editor) document.querySelector<HTMLDialogElement>('.editor-dialog')?.dispatchEvent(new Event('cancel', { cancelable: true })); else if (authOpen) setAuthOpen(false); else if (accountOpen) setAccountOpen(false); else if (sidebar) setSidebar(false); else NativeApp.minimizeApp(); });
    return () => { void listener.then(h => h.remove()); };
  }, [reader, editor, authOpen, accountOpen, sidebar]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !document.querySelector('dialog[open]')) { e.preventDefault(); search.current?.focus(); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);

  function navigate(next: View) { setView(next); setQuery(''); if (window.innerWidth <= 900) setSidebar(false); }
  function create(kind: Kind = 'text') { const note = newNote(scope, kind); if (view.startsWith('label:')) note.body.labels = [view.slice(6)]; setEditor(note); }
  async function save(note: LocalNote, body: NoteBody) { if (hasContent(body) || notes.some(n => n.id === note.id)) await persist(note, body); }
  async function update(note: LocalNote, body: NoteBody) {
    try { await persist(note, body); if (body.trashed !== note.body.trashed) notify(body.trashed ? '메모를 휴지통으로 옮겼어요.' : '메모를 복원했어요.'); }
    catch { notify('저장하지 못했어요. 저장 공간을 확인해 주세요.'); }
  }
  async function open(note: LocalNote) { const key = editorKey(note.scope, note.id); activeEditors.add(key); try { setEditor(await db.notes.get([note.scope, note.id]) || note); } catch { activeEditors.delete(key); notify('메모 저장소를 열 수 없습니다.'); } }
  async function fork(note: Note) {
    try { const current = await request<Note>(`/public/${note.id}`); const next = newNote(scope); next.body = { ...current.body, pinned: false, archived: false, trashed: false, sourceId: current.id }; await persist(next, next.body); setReader(null); navigate('notes'); setEditor(next); notify('내 비공개 메모로 복사했어요. 생각을 이어 써 보세요.'); }
    catch (e) { notify(errorMessage(e)); }
  }
  async function connect(next: Session, bring: boolean) { if (bring) await importGuest(next.user.id); localStorage.setItem('teum-session', JSON.stringify(next)); setSession(next); setEditor(null); setView('notes'); notify('계정이 연결됐어요. 메모를 동기화합니다.'); }
  async function logout() { if (!session) return; try { await request('/auth/logout', session, 'POST'); } catch { /* Local sign-out remains available offline. */ } localStorage.removeItem('teum-session'); setSession(null); setView('notes'); setAccountOpen(false); setSyncError(''); }
  function exportNotes() { const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), notes: notes.map(({ body, visibility, updatedAt, id }) => ({ id, body, visibility, updatedAt })) }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `teum-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url); notify('메모를 JSON 파일로 내보냈어요.'); }
  const title = view === 'notes' ? '메모' : view === 'explore' ? '둘러보기' : view === 'archive' ? '보관함' : view === 'trash' ? '휴지통' : view.slice(6);
  const q = query.trim().toLowerCase();
  const matches = (n: Note) => [n.body.title, n.body.content, ...n.body.items.map(i => i.text), ...n.body.labels, ...(view === 'explore' ? [n.author.name] : [])].join(' ').toLowerCase().includes(q);
  const visible = notes.filter(n => view === 'trash' ? n.body.trashed : !n.body.trashed && (view === 'archive' ? n.body.archived : view.startsWith('label:') ? n.body.labels.includes(view.slice(6)) : !n.body.archived)).filter(matches).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const pinned = visible.filter(n => n.body.pinned); const others = visible.filter(n => !n.body.pinned);
  const status = !session ? '이 기기에 저장됨' : syncError ? '연결 대기 중' : notes.some(n => n.conflict || n.syncError) ? '저장 확인 필요' : syncing ? '동기화 중…' : pending ? '동기화 대기 중' : '동기화됨';
  const card = (n: LocalNote) => <NoteCard key={n.id} note={n} onOpen={() => void open(n)} onChange={b => void update(n, b)} onTag={l => navigate(`label:${l}`)}/>;

  return <div className={`app ${sidebar ? 'sidebar-open' : 'sidebar-closed'}`}>
    <header className="topbar"><div className="brand-area"><IconButton label="메뉴" onClick={() => setSidebar(!sidebar)}><Menu size={23}/></IconButton><a href="/" className="brand" onClick={e => { e.preventDefault(); navigate('notes'); }}><span className="brand-icon">틈</span><span className="brand-name">틈<span>teum</span></span></a></div>
      <div className="search"><Search size={21}/><input ref={search} type="search" aria-label="메모 검색" placeholder={view === 'explore' ? '공개 메모에서 검색' : '메모 검색'} value={query} onChange={e => setQuery(e.target.value)}/>{query ? <IconButton label="검색 지우기" onClick={() => setQuery('')}><X size={18}/></IconButton> : <kbd>/</kbd>}</div>
      <div className="top-actions"><button className="sync-status" onClick={() => void doSync()} title={syncError || status} disabled={syncing || !!editor}>{syncing ? <RefreshCw size={17} className="spin"/> : syncError ? <CloudOff size={18}/> : <Cloud size={18}/>}<span>{status}</span></button><IconButton label={list ? '카드 보기' : '목록 보기'} onClick={() => setList(!list)}>{list ? <LayoutGrid size={22}/> : <Rows3 size={22}/>}</IconButton><IconButton label={dark ? '밝은 테마' : '어두운 테마'} onClick={() => setDark(!dark)}>{dark ? <Sun size={21}/> : <Moon size={21}/>}</IconButton><button className="avatar" title={session ? '계정' : '로그인'} aria-label={session ? '계정' : '로그인'} onClick={() => session ? setAccountOpen(true) : setAuthOpen(true)}>{session ? session.user.name[0].toUpperCase() : '나'}</button></div>
    </header>
    {sidebar && <button className="drawer-shade" aria-label="메뉴 닫기" onClick={() => setSidebar(false)}/>}
    <aside className="sidebar"><nav aria-label="메모 탐색"><button className={view === 'notes' ? 'selected' : ''} onClick={() => navigate('notes')} title="메모"><Lightbulb size={22}/><span>메모</span></button><button className={view === 'explore' ? 'selected' : ''} onClick={() => navigate('explore')} title="둘러보기"><Compass size={22}/><span>둘러보기</span><span className="nav-new">함께</span></button><div className="nav-divider"/><div className="nav-caption">라벨</div>{labels.map(l => <button key={l} className={view === `label:${l}` ? 'selected' : ''} onClick={() => navigate(`label:${l}`)} title={l}><Tag size={20}/><span>{l}</span></button>)}<div className="nav-divider"/><button className={view === 'archive' ? 'selected' : ''} onClick={() => navigate('archive')} title="보관함"><Archive size={22}/><span>보관함</span></button><button className={view === 'trash' ? 'selected' : ''} onClick={() => navigate('trash')} title="휴지통"><Trash2 size={22}/><span>휴지통</span></button></nav><div className="sidebar-footer"><span className="footer-mark">틈</span><p>나를 위해 적고,<br/>가끔은 함께.</p><button onClick={exportNotes}><Download size={14}/> 메모 내보내기</button></div></aside>
    <main>
      {(storageError || initError) && <div className="banner error" role="alert">{storageError || initError}</div>}
      {syncError && <div className="banner" role="status"><CloudOff size={16}/>{syncError}<button onClick={() => void doSync()}>다시 연결</button></div>}
      <div className="workspace-head"><h1>{title}</h1><span>{view === 'explore' ? '누군가의 작은 생각이, 나의 다음 생각으로.' : view === 'trash' ? '잠시 내려놓은 메모. 언제든 복원할 수 있어요.' : view === 'archive' ? '지금은 꺼내두지 않아도 되는 생각들.' : '떠오른 생각을 가볍게 남겨보세요.'}</span>{view === 'explore' && <IconButton label="공개 메모 새로고침" disabled={feedLoading} onClick={() => void loadFeed()}><RefreshCw size={18} className={feedLoading ? 'spin' : ''}/></IconButton>}</div>
      {view !== 'explore' && view !== 'trash' && view !== 'archive' && !query && <div className="composer"><button className="composer-input" onClick={() => create()}>메모 작성…</button><IconButton label="새 체크리스트" onClick={() => create('checklist')}><CheckSquare size={23}/></IconButton><IconButton label="새 메모" onClick={() => create()}><Plus size={24}/></IconButton></div>}
      {query && <p className="results">“{query}” 검색 결과</p>}
      {view === 'explore' ? <>{feedError ? <div className="empty"><CloudOff size={48}/><h2>잠깐, 연결이 필요해요</h2><p>{feedError}</p><button className="text-button" onClick={() => void loadFeed()}>다시 시도</button></div> : feed.filter(matches).length ? <div className={`notes-grid ${list ? 'list' : ''}`}>{feed.filter(matches).map(n => <NoteCard key={n.id} note={n} own={false} onOpen={() => void readPublic(n.id)} onFork={() => void fork(n)} onTag={l => setQuery(l)}/>)}</div> : <div className="empty"><Compass size={52}/><h2>{feedLoading ? '생각을 불러오고 있어요' : '첫 번째 생각을 기다리는 중'}</h2><p>메모의 공개 범위를 ‘전체 공개’로 바꾸면<br/>이곳에서 함께 볼 수 있어요.</p><button className="text-button" onClick={() => session ? navigate('notes') : setAuthOpen(true)}>{session ? '내 메모로 가기' : '계정 연결하기'}<ArrowRight size={16}/></button></div>}</> : <>
        {notes.filter(n => n.syncError).map(n => <div className="banner" key={n.id}><AlertCircle size={18}/><span>‘{n.body.title || '메모'}’ 동기화: {n.syncError}</span><button onClick={() => n.body.sourceId ? void update(n, { ...n.body, sourceId: null }) : void open(n)}>{n.body.sourceId ? '출처 없이 저장' : '메모 수정'}</button></div>)}
        {notes.some(n => n.conflict) && <div className="conflicts">{notes.filter(n => n.conflict).map(n => <div key={n.id}><AlertCircle size={18}/><span>‘{n.body.title || '메모'}’에 다른 기기의 수정이 있어요. 두 내용을 모두 보관할 수 있습니다.</span><button onClick={() => preserveConflict(n).then(() => notify('내 수정본은 새 비공개 메모로 보관했어요.')).catch(() => notify('저장에 실패했어요. 다시 시도해 주세요.'))}>두 버전 보관</button></div>)}</div>}
        {visible.length === 0 ? <div className="empty">{view === 'trash' ? <Trash2 size={52}/> : view === 'archive' ? <Archive size={52}/> : query ? <Search size={52}/> : <Lightbulb size={52}/>}<h2>{query ? '일치하는 메모가 없어요' : view === 'trash' ? '휴지통이 비어 있어요' : view === 'archive' ? '보관한 메모가 없어요' : '첫 생각을 남겨보세요'}</h2><p>{query ? '다른 단어나 라벨로 찾아보세요.' : '짧은 문장도, 정리되지 않은 생각도 좋아요.'}</p></div> : <>{pinned.length > 0 && <><h2 className="section-label">고정된 메모</h2><div className={`notes-grid ${list ? 'list' : ''}`}>{pinned.map(card)}</div></>}{others.length > 0 && <>{pinned.length > 0 && <h2 className="section-label">다른 메모</h2>}<div className={`notes-grid ${list ? 'list' : ''}`}>{others.map(card)}</div></>}</>}
      </>}
      {view === 'notes' && !query && visible.length > 0 && <div className="workspace-foot"><LockKeyhole size={12}/><span>메모는 기본적으로 나만 볼 수 있어요.</span></div>}
    </main>
    <button className="mobile-create" aria-label="새 메모" onClick={() => create()}><Plus size={28}/></button>
    {editorCurrent && <Editor key={editorCurrent.id} note={editorCurrent} onClose={() => setEditor(null)} onSave={b => save(editorCurrent, b)} onVisibility={async visibility => { if (!session) throw new Error('먼저 로그인해 주세요.'); await changeVisibility(editorCurrent, visibility, session); notify(visibility === 'public' ? '이 메모를 함께 볼 수 있어요.' : '이제 나만 볼 수 있어요.'); }} session={session} onSource={id => void readPublic(id)}/>}
    {reader && <PublicReader note={reader} onClose={() => { setReader(null); if (location.search) history.replaceState(null, '', location.pathname); }} onFork={() => void fork(reader)}/>}
    {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} onSession={connect}/>}
    {accountOpen && session && <Modal label="내 계정" onClose={() => setAccountOpen(false)} className="account-dialog"><div className="dialog-heading"><span className="avatar">{session.user.name[0].toUpperCase()}</span><IconButton label="닫기" onClick={() => setAccountOpen(false)}><X size={20}/></IconButton></div><h2>{session.user.name}의 메모장</h2><p>메모는 이 기기에 자동으로 저장되고,<br/>연결되면 계정의 다른 기기에도 반영됩니다.</p><button className="account-action" onClick={exportNotes}><Download size={18}/> 내 메모 내보내기</button><button className="account-action" onClick={() => void logout()}><LogOut size={18}/> 로그아웃</button>{pending > 0 && <p className="small">아직 동기화되지 않은 메모 {pending}개가 있어요. 로그아웃해도 이 기기에 보관되며 같은 계정으로 다시 로그인하면 전송합니다.</p>}</Modal>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}<IconButton label="알림 닫기" onClick={() => setToast('')}><X size={15}/></IconButton></div>}
  </div>;
}
