<script lang="ts">
  import Editor from './Editor.svelte';
  import { uid, type Note, type Session } from '../model';
  let { note, session, onClose, onFork, onProfile, onLogin, onChanged, onTag }: {
    onTag: (tag: string) => void;
    note: Note; session: Session | null; onClose: () => void; onFork: () => void;
    onProfile: (id: string) => void; onLogin: () => void; onChanged: () => void;
  } = $props();
  let local = $derived({ ...note, scope: session?.user.id || 'guest', dirty: false, mutationId: uid() });
</script>
<Editor note={local} {session} readOnly {onClose} {onFork} {onProfile} {onLogin} {onChanged} {onTag} onSave={async () => {}} onVisibility={async () => {}} onSource={() => {}} onSync={async () => {}}/>
