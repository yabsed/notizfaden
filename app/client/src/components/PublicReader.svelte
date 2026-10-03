<script lang="ts">
  import Editor from './Editor.svelte';
  import { uid, type Note, type Session } from '../model';
  let { note, session, onClose, onFork, onProfile, onLogin, onChanged }: {
    note: Note; session: Session | null; onClose: () => void; onFork: () => void;
    onProfile: (id: string) => void; onLogin: () => void; onChanged: () => void;
  } = $props();
  let local = $derived({ ...note, scope: session?.user.id || 'guest', dirty: false, mutationId: uid() });
</script>
<Editor note={local} {session} readOnly {onClose} {onFork} {onProfile} {onLogin} {onChanged} onSave={async () => {}} onVisibility={async () => {}} onSource={() => {}} onSync={async () => {}}/>
