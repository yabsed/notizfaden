<script lang="ts">
  import { displayName, type Profile } from '../social';
  let { person, onOpen }: { person: Profile; onOpen: () => void } = $props();
</script>
<button class="person" onclick={onOpen}>
  <span class="avatar">{person.avatar || displayName(person)[0]}</span><span><strong>{displayName(person)}</strong><small>@{person.name}</small>{#if person.bio}<p>{person.bio}</p>{/if}</span><span class="person-end">{person.blocked ? '차단됨' : person.muted ? '뮤트됨' : person.following ? '팔로잉' : '프로필 →'}</span>
</button>
<style>
  .person { display:flex; align-items:center; text-align:left; gap:12px; padding:15px; border:1px solid var(--line); border-radius:9px; width:100%; min-width:0; }
  .person:hover { background:var(--hover); } .avatar { margin:0; } .person > span:nth-child(2) { min-width:0; } strong { font-size:13px; } small { display:block; color:var(--muted); font-size:11px; margin-top:4px; } p { margin-top:6px; color:var(--muted); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:210px; } .person-end { margin-left:auto; flex-shrink:0; font-size:11px; color:var(--muted); }
</style>
