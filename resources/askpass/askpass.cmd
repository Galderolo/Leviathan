@echo off
rem Invoked by Windows' own OpenSSH (SSH_ASKPASS), which cannot run askpass.sh, with the prompt as argument.
rem Forwards it to the running Leviathan window and prints the answer.
set ELECTRON_RUN_AS_NODE=1
"%LEVIATHAN_ASKPASS_NODE%" "%LEVIATHAN_ASKPASS_MAIN%" %*
