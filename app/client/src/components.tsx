import { Capacitor } from '@capacitor/core';
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { Archive, ArchiveRestore, Check, CheckSquare, Copy, Globe2, LockKeyhole, Palette, Pin, Plus, RotateCcw, Tag, Trash2, X, ExternalLink, ArrowLeft, LoaderCircle, FileText } from 'lucide-react';
import { colors, emptyBody, uid, type LocalNote, type Note, type NoteBody, type Session, type Visibility } from './model';
import { request, errorMessage } from './api';

export function IconButton({ label, children, onClick, active = false, disabled = false, className = '' }: { label: string; children: ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean; className?: string }) {
  return <button type="button" className={`icon-button ${active ? 'active' : ''} ${className}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
export function Modal({ label, children, onClose, className = '' }: { label: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} aria-label={label} className={className} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) onClose(); }}>{children}</dialog>;
}
export function noteStyle(color: string): CSSProperties {
  const value = colors[color] || colors.default;
  return { '--card-light': value.light, '--card-dark': value.dark } as CSSProperties;
}
export function PalettePicker({ selected, onChange }: { selected: string; onChange: (c: string) => void }) {
  return <div className="palette" role="group" aria-label="메모 색상">{Object.entries(colors).map(([key, value]) => <button type="button" key={key} title={value.name} aria-label={value.name} aria-pressed={selected === key} onClick={() => onChange(key)} style={{ background: value.light }} className={selected === key ? 'selected' : ''}>{selected === key && <Check size={16}/>}</button>)}</div>;
}
// Port of googlekeepclone's TodoItem / ContentList composition. Native controls
// replace Material UI v4; checklist updates are immutable and use stable IDs.
export function NoteCard({ note, own = true, onOpen, onChange, onFork, onTag }: { note: Note; own?: boolean; onOpen: () => void; onChange?: (b: NoteBody) => void; onFork?: () => void; onTag?: (l: string) => void }) {
  const b = note.body;
  const [palette, setPalette] = useState(false);
  return <article className={`note-card ${b.color === 'default' ? 'plain' : ''}`} style={noteStyle(b.color)} data-testid="note-card">
    <button className="card-open" onClick={onOpen} aria-label={`${b.title || b.content.slice(0, 30) || '빈 메모'} 열기`} />
    {own && !b.trashed && <div className={`pin-action ${b.pinned ? 'pinned' : ''}`}><IconButton label={b.pinned ? '고정 해제' : '메모 고정'} active={b.pinned} onClick={() => onChange?.({ ...b, pinned: !b.pinned })}><Pin size={18} fill={b.pinned ? 'currentColor' : 'none'}/></IconButton></div>}
    {b.title && <h3>{b.title}</h3>}
    {b.kind === 'checklist' ? <div className="card-checklist">{b.items.slice(0, 9).map(item => <label className={item.done ? 'completed' : ''} key={item.id}><input type="checkbox" checked={item.done} disabled={!own || b.trashed} onChange={() => onChange?.({ ...b, items: b.items.map(i => i.id === item.id ? { ...i, done: !i.done } : i) })}/><span>{item.text || '빈 항목'}</span></label>)}{b.items.length > 9 && <small>+ {b.items.length - 9}개 항목</small>}</div> : <p className="card-text">{b.content || (!b.title ? '빈 메모' : '')}</p>}
    {!!b.labels.length && <div className="labels">{b.labels.map(label => <button key={label} onClick={() => onTag?.(label)}>{label}</button>)}</div>}
    {(note as LocalNote).conflict && <span className="conflict-badge">다른 기기의 수정본이 있어요</span>}
    <div className="card-bottom">
      {own ? <span className="visibility" title={note.visibility === 'public' ? '전체 공개' : '나만 보기'}>{note.visibility === 'public' ? <><Globe2 size={13}/> 전체 공개</> : <LockKeyhole size={12}/>}</span> : <span className="author"><span className="avatar tiny">{note.author.name[0].toUpperCase()}</span>{note.author.name}</span>}
      <div className="card-actions">
        {own ? b.trashed ? <IconButton label="메모 복원" onClick={() => onChange?.({ ...b, trashed: false })}><RotateCcw size={16}/></IconButton> : <>
          <IconButton label="색상 바꾸기" onClick={() => setPalette(!palette)}><Palette size={16}/></IconButton>
          <IconButton label={b.archived ? '보관 해제' : '메모 보관'} onClick={() => onChange?.({ ...b, archived: !b.archived })}>{b.archived ? <ArchiveRestore size={16}/> : <Archive size={16}/>}</IconButton>
          <IconButton label="휴지통으로 이동" onClick={() => onChange?.({ ...b, trashed: true })}><Trash2 size={16}/></IconButton>
        </> : <IconButton label="내 메모로 이어 쓰기" onClick={onFork}><Copy size={16}/></IconButton>}
      </div>
    </div>
    {palette && <div className="card-palette"><PalettePicker selected={b.color} onChange={color => { onChange?.({ ...b, color }); setPalette(false); }}/></div>}
  </article>;
}

export function Editor({ note, onSave, onClose, onVisibility, session, onSource }: { note: LocalNote; onSave: (b: NoteBody) => Promise<void>; onClose: () => void; onVisibility: (v: Visibility) => Promise<void>; session: Session | null; onSource: (id: string) => void }) {
  const [body, setBody] = useState(note.body);
  const [palette, setPalette] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [tag, setTag] = useState('');
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const saveFailed = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(Promise.resolve());
  useEffect(() => { const t = textarea.current; if (t) { t.style.height = 'auto'; t.style.height = Math.max(180, t.scrollHeight) + 'px'; } }, [body.content, body.kind]);
  function change(next: NoteBody) {
    setBody(next); setSaving(true); setError(''); saveFailed.current = false; const version = ++seq.current;
    pending.current = onSave(next).then(() => { if (seq.current === version) setSaving(false); }).catch(() => { saveFailed.current = true; setError('저장하지 못했어요. 저장 공간을 확인하고 다시 시도해 주세요.'); });
  }
  async function close() { await pending.current; if (!saveFailed.current) onClose(); }
  async function share(v: Visibility) { setSharing(true); setError(''); try { await pending.current; await onVisibility(v); } catch (e) { setError(errorMessage(e)); } finally { setSharing(false); } }
  function addTag() { const text = tag.trim().slice(0, 32); if (text && body.labels.length < 20 && !body.labels.includes(text)) change({ ...body, labels: [...body.labels, text] }); setTag(''); }
  return <Modal label="메모 편집" onClose={() => void close()} className="editor-dialog"><div className="editor" style={noteStyle(body.color)}>
    <div className="editor-mobile-head"><IconButton label="메모 닫기" onClick={() => void close()}><ArrowLeft/></IconButton><span>{saving ? '저장 중…' : '기기에 저장됨'}</span></div>
    <div className="editor-title"><input aria-label="메모 제목" placeholder="제목" maxLength={300} value={body.title} onChange={e => change({ ...body, title: e.target.value })}/><IconButton label={body.pinned ? '고정 해제' : '메모 고정'} active={body.pinned} onClick={() => change({ ...body, pinned: !body.pinned })}><Pin size={21} fill={body.pinned ? 'currentColor' : 'none'}/></IconButton></div>
    {body.kind === 'text' ? <textarea autoFocus ref={textarea} aria-label="메모 내용" placeholder="메모 작성…" maxLength={100000} value={body.content} onChange={e => change({ ...body, content: e.target.value })}/> : <div className="editor-checklist">{body.items.map((item, index) => <div className={`editor-item ${item.done ? 'completed' : ''}`} key={item.id}><input type="checkbox" aria-label={`${item.text} 완료`} checked={item.done} onChange={() => change({ ...body, items: body.items.map(i => i.id === item.id ? { ...i, done: !i.done } : i) })}/><input aria-label={`항목 ${index + 1}`} value={item.text} placeholder="목록 항목" maxLength={3000} onChange={e => change({ ...body, items: body.items.map(i => i.id === item.id ? { ...i, text: e.target.value } : i) })} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); const items = [...body.items]; items.splice(index + 1, 0, { id: uid(), text: '', done: false }); change({ ...body, items }); setTimeout(() => document.querySelector<HTMLInputElement>(`input[aria-label="항목 ${index + 2}"]`)?.focus(), 0); } }}/><IconButton label="항목 삭제" onClick={() => change({ ...body, items: body.items.filter(i => i.id !== item.id) })}><X size={16}/></IconButton></div>)}<button className="add-item" onClick={() => change({ ...body, items: [...body.items, { id: uid(), text: '', done: false }] })}><Plus size={18}/> 목록 항목</button></div>}
    {!!body.labels.length && <div className="labels editor-labels">{body.labels.map(l => <button key={l} title={`${l} 라벨 삭제`} onClick={() => change({ ...body, labels: body.labels.filter(v => v !== l) })}>{l}<X size={11}/></button>)}</div>}
    {body.sourceId && <button className="source-link" onClick={() => onSource(body.sourceId!)}><ExternalLink size={13}/> 원본 메모에서 이어 쓴 생각</button>}
    {palette && <PalettePicker selected={body.color} onChange={color => change({ ...body, color })}/>}
    {tagOpen && <form className="tag-form" onSubmit={e => { e.preventDefault(); addTag(); }}><Tag size={16}/><input aria-label="새 라벨" placeholder="라벨 이름" value={tag} onChange={e => setTag(e.target.value)} maxLength={32}/><button type="submit">추가</button></form>}
    <div className="sharing-row"><label><span>{note.visibility === 'public' ? <Globe2 size={15}/> : <LockKeyhole size={15}/>}</span><select aria-label="공개 범위" value={note.visibility} disabled={sharing || !session || !!note.conflict} onChange={e => void share(e.target.value as Visibility)}><option value="private">나만 보기</option><option value="public">전체 공개</option></select></label><span>{sharing ? '변경 중…' : !session ? '로그인하면 메모를 공유할 수 있어요' : note.visibility === 'public' ? '이후 수정한 내용도 함께 공개돼요' : '나를 위한 메모예요'}</span></div>
    {note.visibility === 'public' && (!Capacitor.isNativePlatform() || import.meta.env.VITE_PUBLIC_URL) && <button className="source-link" onClick={async () => { try { await navigator.clipboard.writeText(`${import.meta.env.VITE_PUBLIC_URL || location.origin}/?note=${note.id}`); setLinkCopied(true); } catch { setError('링크 복사에 실패했어요. 브라우저 권한을 확인해 주세요.'); } }}><Copy size={13}/>{linkCopied ? '링크를 복사했어요' : '공개 링크 복사'}</button>}
    {error && <div role="alert" className="error">{error}<button onClick={() => change(body)}>다시 저장</button></div>}
    <div className="editor-toolbar"><div><IconButton label="색상 바꾸기" active={palette} onClick={() => setPalette(!palette)}><Palette size={19}/></IconButton><IconButton label="라벨 추가" active={tagOpen} onClick={() => setTagOpen(!tagOpen)}><Tag size={19}/></IconButton><IconButton label={body.kind === 'text' ? '체크리스트로 바꾸기' : '텍스트로 바꾸기'} onClick={() => change(body.kind === 'text' ? { ...body, kind: 'checklist', items: body.content.split('\n').filter(Boolean).map(text => ({ id: uid(), text, done: false })), content: '' } : { ...body, kind: 'text', content: body.items.map(i => i.text).join('\n'), items: [] })}>{body.kind === 'text' ? <CheckSquare size={19}/> : <FileText size={19}/>}</IconButton><IconButton label={body.archived ? '보관 해제' : '메모 보관'} onClick={() => change({ ...body, archived: !body.archived })}><Archive size={19}/></IconButton></div><span className="save-caption">{saving ? '저장 중…' : '기기에 저장됨'}</span><button className="text-button" onClick={() => void close()}>닫기</button></div>
  </div></Modal>;
}

export function AuthDialog({ onClose, onSession }: { onClose: () => void; onSession: (session: Session, bring: boolean) => Promise<void> }) {
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [bring, setBring] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Modal label="계정 연결" onClose={onClose} className="account-dialog"><div className="dialog-heading"><img className="brand-icon" src="/icon.svg" alt="Notizfaden"/><IconButton label="닫기" onClick={onClose}><X size={20}/></IconButton></div><h2>{register ? '나만의 메모장을 만들어요' : '어디서든, 내 생각 그대로'}</h2><p>계정을 연결하면 다른 기기에서도 메모를 보고,<br/>나누고 싶은 생각을 공개할 수 있어요.</p><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { const session = await request<Session>(`/auth/${register ? 'register' : 'login'}`, null, 'POST', { username, password }); await onSession(session, bring); onClose(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}><label>아이디<input required autoFocus autoComplete="username" placeholder="영문, 숫자, 밑줄 3~30자" minLength={3} maxLength={30} pattern="[a-zA-Z0-9_]+" value={username} onChange={e => setUsername(e.target.value)}/></label><label>비밀번호<input required type="password" autoComplete={register ? 'new-password' : 'current-password'} placeholder="10자 이상" minLength={10} maxLength={128} value={password} onChange={e => setPassword(e.target.value)}/></label><label className="import-check"><input type="checkbox" checked={bring} onChange={e => setBring(e.target.checked)}/> 이 기기의 시작 메모와 개인 메모도 계정으로 복사</label>{error && <div className="error" role="alert">{error}</div>}<button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : register ? '메모장 만들기' : '로그인'}</button></form><button className="auth-switch" onClick={() => { setRegister(!register); setError(''); }}>{register ? '이미 계정이 있어요 · 로그인' : '처음 오셨나요? 계정 만들기'}</button></Modal>;
}

export function PublicReader({ note, onClose, onFork }: { note: Note; onClose: () => void; onFork: () => void }) {
  return <Modal label="공개 메모" onClose={onClose} className="editor-dialog"><div className="reader" style={noteStyle(note.body.color)}><div className="reader-head"><span className="author"><span className="avatar tiny">{note.author.name[0].toUpperCase()}</span>{note.author.name}</span><IconButton label="닫기" onClick={onClose}><X size={20}/></IconButton></div><h2>{note.body.title}</h2>{note.body.kind === 'checklist' ? note.body.items.map(i => <p key={i.id} className={i.done ? 'completed' : ''}>{i.done ? '☑' : '☐'} {i.text}</p>) : <p className="reader-content">{note.body.content}</p>}<div className="reader-footer"><span><Globe2 size={14}/> 전체 공개</span><button className="text-button" onClick={onFork}><Copy size={16}/> 내 메모로 이어 쓰기</button></div></div></Modal>;
}
