---
name: vmwp-wsl-vm-machine-quirks
description: "On Jett's PC the persistent vmwp.exe is the Claude desktop app's Cowork sandbox VM (cowork-vm-*), recreated on app launch; also stale Docker Run key and `bash` resolving to the WSL launcher"
metadata: 
  node_type: memory
  type: reference
  originSessionId: d273732a-9369-445b-8b6d-440b45030f19
  modified: 2026-08-05T06:51:51.460Z
---

Diagnosed 2026-08-05. FINAL ANSWER: the persistent vmwp.exe/vmmem pair is the **Claude desktop app's Cowork sandbox VM** (`hcsdiag list` → `cowork-vm-b133c02d`, ~64 MB idle, headless). Confirmed twice: killed via elevated `Stop-Process -Name vmwp -Force`, then launching claude.exe (02:48:54) recreated the VM 40 s later (02:49:37). It survives `wsl --shutdown` because it is NOT a WSL VM. The user's suspicion "Claude relaunches vmwp" was CORRECT for the desktop app — Claude Code CLI's Bash tool itself uses no VM on native Windows. Closing the Claude desktop app is the way to keep it gone.

Other findings:

- `vmcompute.exe` spawns one vmwp.exe per running VM; Docker Desktop's WSL2 backend (docker-desktop distro) is a second, separate vmwp source on this machine.
- `where.exe bash` → `C:\Windows\System32\bash.exe` FIRST (the WSL launcher, not Git Bash). Any tool/script invoking plain `bash` from PowerShell/cmd silently boots the WSL VM. Avoid shelling out to bare `bash` outside the Bash tool.
- Docker Desktop is in HKCU Run (autostarts at sign-in) and uses the WSL2 backend — another recurring vmwp source.
- Full Hyper-V role installed (vmms Automatic); hcsdiag/Get-VM need admin (user not in Hyper-V Administrators).
- Quick kill: `wsl --shutdown`.

- Docker Desktop's "start at sign-in" checkbox is UNCHECKED per user, but a stale "Docker Desktop" HKCU Run entry remained with StartupApproved=enabled (offered `reg delete ... /v "Docker Desktop"` to remove). Opening the Docker GUI always boots the docker-desktop distro regardless of that setting.
