<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Archive, ArrowLeft, CheckSquare, ExternalLink, FileText, Globe2, LockKeyhole, Palette, Pin, Plus, Hash, X, Type, Undo2, Redo2 } from '@lucide/svelte';
  import { cleanTag, noteTags, tagKey, uniqueTags } from '../tags';
  import type { Editor as TiptapEditor } from '@tiptap/core';
  import { hasFormatting } from '../richText';
  import NoteDiscussion from './NoteDiscussion.svelte';
  import RichTextView from './RichTextView.svelte';
  import { displayName, type Post } from '../social';
  import RichTextEditor from './RichTextEditor.svelte';
  import { noteStyle, uid, type LocalNote, type NoteBody, type Session, type Visibility } from '../model';
  import { errorMessage } from '../api';
  import IconButton from './IconButton.svelte';
  import Modal from './Modal.svelte';
  import PalettePicker from './PalettePicker.svelte';
  let { note, onSave, onClose, onVisibility, session, onSource, readOnly = false, startEditing = false, onSync, onProfile, onLogin, onChanged, onFork, onTag }: {
    onTag: (tag: string) => void;
    readOnly?: boolean; startEditing?: boolean; onSync: (note: LocalNote) => Promise<void>; onProfile: (id: string) => void; onLogin: () => void; onChanged: () => void; onFork?: () => void;
    note: LocalNote; onSave: (note: LocalNote, body: NoteBody) => Promise<void>; onClose: () => void;
    onVisibility: (note: LocalNote, visibility: Visibility) => Promise<void>; session: Session | null; onSource: (id: string) => void;
  } = $props();
  let editing = $state(untrack(() => !readOnly && startEditing));
  let viewing = $derived(readOnly || !editing);
  let body = $state(structuredClone(untrack(() => note.body)));
  let palette = $state(false), tagOpen = $state(false), tag = $state('');
  let remote = $state.raw<Post | null>(null), unavailable = $state(false);
  let current = $derived(readOnly && remote ? remote.note : note);
  $effect(() => { if (readOnly) body = structuredClone(current.body); });
  let saving = $state(false), sharing = $state(false), error = $state('');
  let richEditor = $state.raw<TiptapEditor | null>(null);
  let formatting = $state(false), canUndo = $state(false), canRedo = $state(false), confirmChecklist = $state(false);
  let last = JSON.stringify(untrack(() => body)), seq = 0, failed = false, pending = Promise.resolve();

  // Persist plain snapshots, in order. Binding changes are batched without saving on mount.
  $effect(() => {
    if (readOnly) return;
    const snapshot = $state.snapshot(body), signature = JSON.stringify(snapshot);
    untrack(() => { if (signature !== last) { last = signature; save(snapshot); } });
  });
  function save(snapshot = $state.snapshot(body)) {
    saving = true; error = '';
    const version = ++seq, target = note;
    pending = pending.then(() => onSave(target, snapshot)).then(() => {
      if (seq === version) { saving = false; failed = false; }
    }).catch(() => {
      if (seq === version) { saving = false; failed = true; error = '저장하지 못했어요. 저장 공간을 확인하고 다시 시도해 주세요.'; }
    });
  }
  async function finishEdit() {
    await tick(); await pending;
    if (failed) return;
    editing = false; formatting = false; palette = false; tagOpen = false;
    if (session) { try { await onSync(note); } catch (e) { error = errorMessage(e); } }
  }
  async function close() { await tick(); await pending; if (!failed) onClose(); }
  async function beforeInteract() {
    if (readOnly) return;
    await tick(); await pending;
    if (failed) throw new Error('먼저 메모를 저장해 주세요.');
    await onSync(note);
  }
  function loaded(post: Post) { remote = post; unavailable = false; }
  async function share(visibility: Visibility) {
    sharing = true; error = '';
    try { await tick(); await pending; if (failed) throw new Error('메모 저장을 마친 뒤 공개 범위를 바꿔 주세요.'); await onVisibility(note, visibility); unavailable = false; if (visibility === 'private') editing = true; }
    catch (e) { error = errorMessage(e); }
    finally { sharing = false; }
  }
  function addTag() {
    const text = cleanTag(tag).slice(0, 32);
    if (text && noteTags(body).length < 20) body.labels = uniqueTags([...body.labels, text]);
    tag = '';
  }
  async function findTag(value: string) {
    await tick(); await pending;
    if (!failed) { onClose(); onTag(value); }
  }
  async function insert(index = body.items.length) {
    body.items.splice(index, 0, { id: uid(), text: '', done: false });
    await tick(); document.querySelector<HTMLInputElement>(`input[aria-label="항목 ${index + 1}"]`)?.focus();
  }
  function toggleKind(confirmed = false) {
    if (body.kind === 'text') {
      const lines = body.content.split('\n').filter(Boolean);
      if (lines.length > 500 || lines.some(line => line.length > 3000)) { error = '체크리스트는 500개 항목, 항목마다 3,000자까지 가능해요. 내용을 나누어 주세요.'; return; }
      if (!confirmed && hasFormatting(body.content, body.richText)) { confirmChecklist = true; return; }
      body.items = lines.map(text => ({ id: uid(), text, done: false })); body.content = ''; body.richText = null; body.kind = 'checklist';
    } else {
      const text = body.items.map(i => i.text).join('\n');
      if (text.length > 100000) { error = '본문은 100,000자까지 가능해요. 내용을 나누어 주세요.'; return; }
      body.content = text; body.richText = null; body.items = []; body.kind = 'text';
    }
    confirmChecklist = false;
  }
</script>

<Modal label={readOnly ? (current.visibility === 'public' ? '공개 메모' : '비공개 메모') : '메모 편집'} onClose={close} class="editor-dialog">
  <div class="editor" style={noteStyle(body.color)}>
    <div class="editor-header">
      <div class="mobile-back"><IconButton label="메모 닫기" icon={ArrowLeft} onclick={close}/></div>
      <button class="author" onclick={() => onProfile(note.author.id)}><span class="avatar tiny">{remote?.profile.avatar || (session?.user.id === note.author.id ? session.user.name[0] : note.author.name[0])}</span><span>{remote ? displayName(remote.profile) : note.author.name}</span></button>
      <span class="visibility-badge">{current.visibility === 'public' ? '공개' : '비공개'}</span>
      <div class="header-actions">{#if !readOnly}<span class="save-caption" role="status">{saving ? '저장 중…' : '기기에 저장됨'}</span><button class="text-button mode-toggle" disabled={sharing} onclick={() => editing ? finishEdit() : editing = true}>{editing ? '편집 완료' : '편집'}</button>{/if}<button class="text-button close-button" onclick={close}>닫기</button></div>
    </div>
    {#if !viewing}<div class="editor-toolbar" role="toolbar" aria-label="메모 편집 도구"><div>
      {#if body.kind === 'text'}<IconButton label="서식 도구" icon={Type} size={19} active={formatting} onclick={() => formatting = !formatting}/>{/if}
      <IconButton label="색상 바꾸기" icon={Palette} size={19} active={palette} onclick={() => palette = !palette}/>
      <IconButton label="태그 추가" icon={Hash} size={19} active={tagOpen} onclick={() => tagOpen = !tagOpen}/>
      <IconButton label={body.kind === 'text' ? '체크리스트로 바꾸기' : '텍스트로 바꾸기'} icon={body.kind === 'text' ? CheckSquare : FileText} size={19} onclick={() => toggleKind()}/>
      <IconButton label={body.archived ? '보관 해제' : '메모 보관'} icon={Archive} size={19} onclick={() => body.archived = !body.archived}/>
      {#if body.kind === 'text'}
        <IconButton label="실행 취소" icon={Undo2} size={19} disabled={!canUndo} onclick={() => richEditor?.chain().focus().undo().run()}/>
        <IconButton label="다시 실행" icon={Redo2} size={19} disabled={!canRedo} onclick={() => richEditor?.chain().focus().redo().run()}/>
      {/if}
    </div></div>{/if}
    <div class="editor-content">
      {#if !unavailable || !readOnly}
      <section class="note-surface" aria-label="메모 내용">
      <div class="editor-title">
        <input aria-label="메모 제목" placeholder="제목" maxlength={300} readonly={viewing} onclick={() => { if (!readOnly) editing = true; }} bind:value={body.title}/>
        {#if !viewing}<IconButton label={body.pinned ? '고정 해제' : '메모 고정'} icon={Pin} size={21} active={body.pinned} fill={body.pinned ? 'currentColor' : 'none'} onclick={() => body.pinned = !body.pinned}/>{/if}
      </div>
      {#if body.kind === 'text' && readOnly}<div class="reader-content"><RichTextView text={body.content} richText={body.richText}/></div>
      {:else if body.kind === 'text'}
        <RichTextEditor text={body.content} richText={body.richText} {formatting} editable={!viewing} onActivate={() => editing = true} bind:editor={richEditor}
          onChange={(text, value) => { body.content = text; body.richText = value; }}
          onHistory={(undo, redo) => { canUndo = undo; canRedo = redo; }}/>
      {:else}
        <div class="editor-checklist">
          {#each body.items as item, index (item.id)}
            <div class="editor-item" class:completed={item.done}>
              <input type="checkbox" aria-label={`${item.text} 완료`} disabled={readOnly} onchange={() => { if (!readOnly) editing = true; }} bind:checked={item.done}/>
              <input aria-label={`항목 ${index + 1}`} placeholder="목록 항목" maxlength={3000} readonly={viewing} onclick={() => { if (!readOnly) editing = true; }} bind:value={item.text} onkeydown={e => { if (!viewing && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void insert(index + 1); } }}/>
              {#if !viewing}<IconButton label="항목 삭제" icon={X} size={16} onclick={() => body.items.splice(index, 1)}/>{/if}
            </div>
          {/each}
          {#if !viewing}<button class="add-item" onclick={() => insert()}><Plus size={18}/> 목록 항목</button>{/if}
        </div>
      {/if}
      {#if body.labels.length}<div class="tags editor-tags">{#each noteTags(body) as value}<span class="editor-tag"><button onclick={() => findTag(value)}>#{value}</button>{#if !viewing}<button aria-label={`#${value} 태그 삭제`} onclick={() => body.labels = body.labels.filter(item => tagKey(item) !== tagKey(value))}><X size={12}/></button>{/if}</span>{/each}</div>{/if}
      {#if !viewing}
      {#if body.sourceId}<button class="source-link" onclick={() => onSource(body.sourceId!)}><ExternalLink size={13}/> 원본 메모에서 이어 쓴 생각</button>{/if}
      {#if palette}<PalettePicker selected={body.color} onChange={color => body.color = color}/>{/if}
      {#if tagOpen}<form class="tag-form" onsubmit={e => { e.preventDefault(); addTag(); }}><Hash size={16}/><input aria-label="새 태그" placeholder="태그 이름" maxlength={33} bind:value={tag}/><button type="submit">추가</button></form><p class="tag-hint">{note.visibility === 'public' ? '이 메모의 태그는 공개 검색에 표시돼요.' : '메모를 공개하면 태그도 함께 공개돼요.'}</p>{/if}
      <div class="sharing-row">
        <label><span>{#if note.visibility === 'public'}<Globe2 size={15}/>{:else}<LockKeyhole size={15}/>{/if}</span>
          <select aria-label="공개 범위" value={note.visibility} disabled={sharing || !session || !!note.conflict} onchange={e => { const next = e.currentTarget.value as Visibility; e.currentTarget.value = note.visibility; void share(next); }}>
            <option value="private">나만 보기</option><option value="public">전체 공개</option>
          </select>
        </label>
        <span>{sharing ? '변경 중…' : !session ? '로그인하면 메모를 공유할 수 있어요' : note.visibility === 'public' ? '비공개로 바꾸면 좋아요와 댓글이 삭제돼요' : '나를 위한 메모예요'}</span>
      </div>


      {#if confirmChecklist}<div class="conversion-confirm" role="group" aria-label="체크리스트 전환 확인"><p>체크리스트로 바꾸면 제목 서식과 굵게·기울임·밑줄이 지워져요.</p><button class="text-button" onclick={() => confirmChecklist = false}>취소</button><button class="text-button" onclick={() => toggleKind(true)}>서식 지우고 전환</button></div>{/if}
      {/if}
      </section>
      {/if}
      {#if current.visibility === 'public' && !body.trashed && !unavailable}<NoteDiscussion note={current} {session} ready={note.revision > 0} {beforeInteract} {onProfile} {onLogin} {onChanged} {onFork} onLoaded={loaded} onUnavailable={() => { unavailable = true; if (readOnly) onClose(); }}/>{/if}
      {#if error}<div role="alert" class="error">{error}<button onclick={() => save()}>다시 저장</button></div>{/if}
    </div>

  </div>
</Modal>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    max-height: min(90dvh, calc(100dvh - 32px - var(--app-safe-top) - var(--app-safe-bottom)));
    background: var(--card-light);
    color: var(--fg);
  }

  :global([data-theme=dark]) .editor { background: var(--card-dark); }

  .editor-content {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .editor-header {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 62px;
    padding: 8px 20px 8px 24px;
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
  }

  .editor-header .author {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 40px;
    font-size: 13px;
  }

  .editor-header .author > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .visibility-badge {
    flex-shrink: 0;
    padding: 5px 8px;
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1;
  }

  .header-actions { display:flex; align-items:center; gap:8px; margin-left:auto; flex-shrink:0; }
  .mode-toggle { font-weight:600; white-space:nowrap; }
  .mobile-back { display:none; }

  .note-surface {
    padding: 18px 0 20px;
    border-bottom: 1px solid #8883;
  }

  .reader-content {
    padding: 8px 24px 20px;
    font-size: 16px;
    line-height: 1.85;
  }

  .editor-title {
    display: flex;
    align-items: center;
    padding: 0 18px 6px 24px;
    gap: 10px;
  }

  .editor-title input {
    font-size: 21px;
    font-weight: 600;
    flex: 1;
    min-width: 0;
    background: none;
    border: 0;
    padding: 10px 0;
    color: inherit;
  }

  .conversion-confirm { margin: 0 20px 12px; padding: 12px; background: var(--hover); border-radius: 8px; font-size: 13px; }

  .editor-content > :global(.palette) {
    padding: 12px 24px;
  }

  .tag-hint { margin:8px 0; color:var(--muted); font-size:12px; }
  .editor-tag { display:inline-flex; align-items:center; }
  .editor-tags {
    margin: 0 24px 16px;
  }

  .editor-toolbar {
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: center;
    padding: 4px 16px;
    flex-shrink: 0;
  }

  .editor-toolbar > div {
    display: flex;
    gap: 5px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .save-caption {
    font-size: 12px;
    color: var(--muted);
  }

  .sharing-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 24px;
    font-size: 12px;
    flex-wrap: wrap;
  }

  .sharing-row > label {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .sharing-row select {
    background: transparent;
    color: inherit;
    border: none;
    padding: 6px 3px;
    cursor: pointer;
    font-size: 12px;
  }

  .sharing-row select:disabled {
    opacity: .75;
    cursor: default;
  }

  .sharing-row > span {
    color: var(--muted);
    font-size: 11px;
  }

  .editor-checklist {
    padding: 8px 20px 22px;
    min-height: 90px;
  }

  .editor-item {
    display: flex;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid transparent;
  }

  .editor-item:focus-within {
    border-color: #8884;
  }

  .editor-item > input:not([type=checkbox]) {
    flex: 1;
    width: 0;
    border: 0;
    background: transparent;
    padding: 8px 0;
    font-size: 14px;
    color: inherit;
  }

  .editor-item :global(.icon-button) {
    width: 30px;
    height: 30px;
  }

  .add-item {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 12px 4px;
    color: var(--icon);
    font-size: 13px;
  }

  .tag-form {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 24px;
    padding: 6px 0;
    border-bottom: 1px solid #8884;
  }

  .tag-form input {
    background: none;
    border: 0;
    min-width: 0;
    flex: 1;
    padding: 6px;
  }

  .tag-form button {
    font-size: 12px;
    padding: 6px;
  }

  .source-link {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 24px;
    margin-bottom: 16px;
    font-size: 11px;
    color: var(--icon);
  }

  .editor-content > .error {
    margin: 0 20px 12px;
  }

  @media (max-width: 600px) {
    .editor-tags {
      margin-top: 12px;
    }

    .editor {
      height: 100%;
      max-height: 100%;
      padding: var(--app-safe-top) var(--app-safe-right) 0 var(--app-safe-left);
    }

    .editor-content {
      flex: 1;
      padding-bottom:var(--app-safe-bottom);
    }

    .editor-header { min-height: 60px; padding: 6px 12px; gap: 6px; }
    .mobile-back { display:block; flex-shrink:0; }
    .editor-header .author { font-size:12px; }
    .visibility-badge { font-size:11px; padding:5px 7px; }
    .header-actions { gap:2px; }
    .header-actions .save-caption { display:none; }
    .header-actions .text-button { min-width:40px; padding-inline:7px; }
    .reader-content { padding: 10px 22px 20px; }

    .editor-title {
      padding: 4px 15px 8px 22px;
    }

    .editor-title input {
      font-size: 20px;
    }

    .editor-toolbar :global(.icon-button) { width: 36px; height: 40px; flex-shrink:0; }
    .editor-toolbar > div { gap: 2px; }

    .editor-toolbar {
      padding: 4px 12px;
    }

    .sharing-row {
      padding: 12px 22px;
      gap: 8px;
    }

  }
</style>
