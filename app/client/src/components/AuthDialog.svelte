<script lang="ts">
  import { LoaderCircle, X } from '@lucide/svelte';
  import { request, errorMessage } from '../api';
  import type { Session } from '../model';
  import IconButton from './IconButton.svelte';
  import Modal from './Modal.svelte';
  let { onClose, onSession }: { onClose: () => void; onSession: (session: Session, bring: boolean) => Promise<void> } = $props();
  let register = $state(false), username = $state(''), password = $state(''), bring = $state(false), busy = $state(false), error = $state('');
  async function submit(e: SubmitEvent) {
    e.preventDefault(); busy = true; error = '';
    try { await onSession(await request<Session>(`/auth/${register ? 'register' : 'login'}`, null, 'POST', { username, password }), bring); onClose(); }
    catch (e) { error = errorMessage(e); }
    finally { busy = false; }
  }
</script>

<Modal label="계정 연결" {onClose} class="account-dialog">
  <div class="dialog-heading"><img class="brand-icon" src="/icon.svg" alt="Notizfaden"/><IconButton label="닫기" icon={X} onclick={onClose}/></div>
  <h2>{register ? '나만의 메모장을 만들어요' : '어디서든, 내 생각 그대로'}</h2>
  <p>계정을 연결하면 다른 기기에서도 메모를 보고,<br/>나누고 싶은 생각을 공개할 수 있어요.</p>
  <form onsubmit={submit}>
    <label>아이디
      <!-- svelte-ignore a11y_autofocus (Focus the form after the user opens its modal.) -->
      <input required autofocus autocomplete="username" placeholder="영문, 숫자, 밑줄 3~30자" minlength={3} maxlength={30} pattern="[a-zA-Z0-9_]+" bind:value={username}/>
    </label>
    <label>비밀번호<input required type="password" autocomplete={register ? 'new-password' : 'current-password'} placeholder="10자 이상" minlength={10} maxlength={128} bind:value={password}/></label>
    <label class="import-check"><input type="checkbox" bind:checked={bring}/> 이 기기의 시작 메모와 개인 메모도 계정으로 복사</label>
    {#if error}<div class="error" role="alert">{error}</div>{/if}
    <button class="primary-button" disabled={busy}>{#if busy}<LoaderCircle class="spin" size={18}/>{:else}{register ? '메모장 만들기' : '로그인'}{/if}</button>
  </form>
  <button class="auth-switch" onclick={() => { register = !register; error = ''; }}>{register ? '이미 계정이 있어요 · 로그인' : '처음 오셨나요? 계정 만들기'}</button>
</Modal>

<style>
  :global(.account-dialog) form > label {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
    margin: 16px 0;
  }

  :global(.account-dialog) input:not([type=checkbox]) {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    padding: 12px;
    font-size: 14px;
  }

  :global(.account-dialog) input:focus {
    border-color: #4b5f88;
  }

  :global(.account-dialog) .import-check {
    flex-direction: row;
    align-items: center;
    font-size: 11px;
    line-height: 1.7;
    color: var(--muted);
  }

  .primary-button {
    background: #4b5f88;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 44px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    margin-top: 22px;
  }

  .auth-switch {
    font-size: 12px;
    color: var(--icon);
    width: 100%;
    margin-top: 22px;
    text-align: center;
  }
</style>
