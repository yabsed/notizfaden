<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Capacitor } from '@capacitor/core';
  import { Archive, ArrowLeft, CheckSquare, Copy, ExternalLink, FileText, Globe2, LockKeyhole, Palette, Pin, Plus, Tag, X, Type, Undo2, Redo2 } from '@lucide/svelte';
  import type { Editor as TiptapEditor } from '@tiptap/core';
  import { hasFormatting } from '../richText';
  import RichTextEditor from './RichTextEditor.svelte';
  import { noteStyle, uid, type LocalNote, type NoteBody, type Session, type Visibility } from '../model';
  import { errorMessage } from '../api';
  import IconButton from './IconButton.svelte';
  import Modal from './Modal.svelte';
  import PalettePicker from './PalettePicker.svelte';
  let { note, onSave, onClose, onVisibility, session, onSource }: {
    note: LocalNote; onSave: (note: LocalNote, body: NoteBody) => Promise<void>; onClose: () => void;
    onVisibility: (note: LocalNote, visibility: Visibility) => Promise<void>; session: Session | null; onSource: (id: string) => void;
  } = $props();
  let body = $state(structuredClone(untrack(() => note.body)));
  let palette = $state(false), tagOpen = $state(false), tag = $state('');
  let saving = $state(false), sharing = $state(false), linkCopied = $state(false), error = $state('');
  let richEditor = $state.raw<TiptapEditor | null>(null);
  let formatting = $state(false), canUndo = $state(false), canRedo = $state(false), confirmChecklist = $state(false);
  let last = JSON.stringify(untrack(() => body)), seq = 0, failed = false, pending = Promise.resolve();

  // Persist plain snapshots, in order. Binding changes are batched without saving on mount.
  $effect(() => {
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
  async function close() { await tick(); await pending; if (!failed) onClose(); }
  async function share(visibility: Visibility) {
    sharing = true; error = '';
    try { await tick(); await pending; if (failed) throw new Error('메모 저장을 마친 뒤 공개 범위를 바꿔 주세요.'); await onVisibility(note, visibility); }
    catch (e) { error = errorMessage(e); }
    finally { sharing = false; }
  }
  function addTag() { const text = tag.trim().slice(0, 32); if (text && body.labels.length < 20 && !body.labels.includes(text)) body.labels.push(text); tag = ''; }
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
  async function copyLink() {
    try { await navigator.clipboard.writeText(`${import.meta.env.VITE_PUBLIC_URL || location.origin}/?note=${note.id}`); linkCopied = true; }
    catch { error = '링크 복사에 실패했어요. 브라우저 권한을 확인해 주세요.'; }
  }
</script>

<Modal label="메모 편집" onClose={close} class="editor-dialog">
  <div class="editor" style={noteStyle(body.color)}>
    <div class="editor-mobile-head"><IconButton label="메모 닫기" icon={ArrowLeft} onclick={close}/><span>{saving ? '저장 중…' : '기기에 저장됨'}</span></div>
    <div class="editor-content">
      {#if note.visibility === 'public'}<p class="public-edit-hint">전체 공개 · 수정한 내용도 다른 사람에게 보여요.</p>{/if}
      <div class="editor-title">
        <input aria-label="메모 제목" placeholder="제목" maxlength={300} bind:value={body.title}/>
        <IconButton label={body.pinned ? '고정 해제' : '메모 고정'} icon={Pin} size={21} active={body.pinned} fill={body.pinned ? 'currentColor' : 'none'} onclick={() => body.pinned = !body.pinned}/>
      </div>
      {#if body.kind === 'text'}
        <RichTextEditor text={body.content} richText={body.richText} {formatting} bind:editor={richEditor}
          onChange={(text, value) => { body.content = text; body.richText = value; }}
          onHistory={(undo, redo) => { canUndo = undo; canRedo = redo; }}/>
      {:else}
        <div class="editor-checklist">
          {#each body.items as item, index (item.id)}
            <div class="editor-item" class:completed={item.done}>
              <input type="checkbox" aria-label={`${item.text} 완료`} bind:checked={item.done}/>
              <input aria-label={`항목 ${index + 1}`} placeholder="목록 항목" maxlength={3000} bind:value={item.text} onkeydown={e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void insert(index + 1); } }}/>
              <IconButton label="항목 삭제" icon={X} size={16} onclick={() => body.items.splice(index, 1)}/>
            </div>
          {/each}
          <button class="add-item" onclick={() => insert()}><Plus size={18}/> 목록 항목</button>
        </div>
      {/if}
      {#if body.labels.length}<div class="labels editor-labels">{#each body.labels as label, index}<button title={`${label} 라벨 삭제`} onclick={() => body.labels.splice(index, 1)}>{label}<X size={11}/></button>{/each}</div>{/if}
      {#if body.sourceId}<button class="source-link" onclick={() => onSource(body.sourceId!)}><ExternalLink size={13}/> 원본 메모에서 이어 쓴 생각</button>{/if}
      {#if palette}<PalettePicker selected={body.color} onChange={color => body.color = color}/>{/if}
      {#if tagOpen}<form class="tag-form" onsubmit={e => { e.preventDefault(); addTag(); }}><Tag size={16}/><input aria-label="새 라벨" placeholder="라벨 이름" maxlength={32} bind:value={tag}/><button type="submit">추가</button></form>{/if}
      <div class="sharing-row">
        <label><span>{#if note.visibility === 'public'}<Globe2 size={15}/>{:else}<LockKeyhole size={15}/>{/if}</span>
          <select aria-label="공개 범위" value={note.visibility} disabled={sharing || !session || !!note.conflict} onchange={e => { const next = e.currentTarget.value as Visibility; e.currentTarget.value = note.visibility; void share(next); }}>
            <option value="private">나만 보기</option><option value="public">전체 공개</option>
          </select>
        </label>
        <span>{sharing ? '변경 중…' : !session ? '로그인하면 메모를 공유할 수 있어요' : note.visibility === 'public' ? '이후 수정한 내용도 함께 공개돼요' : '나를 위한 메모예요'}</span>
      </div>
      {#if note.visibility === 'public' && (!Capacitor.isNativePlatform() || import.meta.env.VITE_PUBLIC_URL)}<button class="source-link" onclick={copyLink}><Copy size={13}/>{linkCopied ? '링크를 복사했어요' : '공개 링크 복사'}</button>{/if}
      {#if confirmChecklist}<div class="conversion-confirm" role="group" aria-label="체크리스트 전환 확인"><p>체크리스트로 바꾸면 제목 서식과 굵게·기울임·밑줄이 지워져요.</p><button class="text-button" onclick={() => confirmChecklist = false}>취소</button><button class="text-button" onclick={() => toggleKind(true)}>서식 지우고 전환</button></div>{/if}
      {#if error}<div role="alert" class="error">{error}<button onclick={() => save()}>다시 저장</button></div>{/if}
    </div>
    <div class="editor-toolbar"><div>
      {#if body.kind === 'text'}<IconButton label="서식 도구" icon={Type} size={19} active={formatting} onclick={() => formatting = !formatting}/>{/if}
      <IconButton label="색상 바꾸기" icon={Palette} size={19} active={palette} onclick={() => palette = !palette}/>
      <IconButton label="라벨 추가" icon={Tag} size={19} active={tagOpen} onclick={() => tagOpen = !tagOpen}/>
      <IconButton label={body.kind === 'text' ? '체크리스트로 바꾸기' : '텍스트로 바꾸기'} icon={body.kind === 'text' ? CheckSquare : FileText} size={19} onclick={() => toggleKind()}/>
      <IconButton label={body.archived ? '보관 해제' : '메모 보관'} icon={Archive} size={19} onclick={() => body.archived = !body.archived}/>
      {#if body.kind === 'text'}
        <IconButton label="실행 취소" icon={Undo2} size={19} disabled={!canUndo} onclick={() => richEditor?.chain().focus().undo().run()}/>
        <IconButton label="다시 실행" icon={Redo2} size={19} disabled={!canRedo} onclick={() => richEditor?.chain().focus().redo().run()}/>
      {/if}
    </div><span class="save-caption">{saving ? '저장 중…' : '기기에 저장됨'}</span><button class="text-button" onclick={close}>닫기</button></div>
  </div>
</Modal>

<style>
  .public-edit-hint { font-size:11px; color:var(--muted); padding:0 0 12px; }
  :global([data-theme=dark]) .editor {
    background: var(--card-dark);
    color: var(--fg);
  }

  .editor {
    padding: 14px 0 0;
    background: var(--card-light);
  }

  .editor-content {
    display: contents;
  }

  .editor-title {
    display: flex;
    align-items: center;
    padding: 0 18px 6px 24px;
    gap: 10px;
  }

  .editor-title input {
    font-size: 19px;
    font-weight: 500;
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

  .editor-labels {
    margin: 0 24px 16px;
  }

  .editor-toolbar {
    border-top: 1px solid #8882;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 14px;
    flex-wrap: wrap;
  }

  .editor-toolbar > div {
    display: flex;
    gap: 3px;
  }

  .save-caption {
    font-size: 10px;
    color: var(--muted);
    margin-left: auto;
  }

  .editor-toolbar .text-button {
    min-width: 64px;
  }

  .sharing-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 24px;
    font-size: 11px;
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
    font-size: 10px;
  }

  .editor-checklist {
    padding: 8px 20px 22px;
    min-height: 170px;
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

  .editor-mobile-head {
    display: none;
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
    .editor-labels {
      margin-top: 12px;
    }

    .editor {
      height: 100%;
      padding: var(--app-safe-top) var(--app-safe-right) 0 var(--app-safe-left);
      display: flex;
      flex-direction: column;
    }

    .editor-content {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }

    .editor-content > * {
      flex-shrink: 0;
    }

    .editor-mobile-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 12px;
      font-size: 10px;
      color: var(--muted);
      flex-shrink: 0;
    }

    .editor-title {
      padding: 4px 15px 8px 22px;
    }

    .editor-title input {
      font-size: 20px;
    }

    .editor-toolbar :global(.icon-button) { width: 32px; height: 38px; }
    .editor-toolbar > div { gap: 0; }

    .editor-toolbar {
      padding: 8px 10px calc(8px + var(--app-safe-bottom));
      flex-shrink: 0;
    }

    .editor-toolbar .save-caption {
      display: none;
    }

    .editor-toolbar > .text-button {
      margin-left: auto;
    }

    .sharing-row {
      padding: 12px 22px;
      gap: 8px;
    }

    .editor-checklist {
      flex: 1;
    }
  }
</style>
