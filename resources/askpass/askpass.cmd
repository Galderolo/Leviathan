@echo off
rem Invoked by ssh on Windows (SSH_ASKPASS), with the prompt as argument: Windows' own OpenSSH cannot run askpass.sh.
rem Forwards it to the running Leviathan window and prints the answer.
rem cmd keeps only the first line of an argument, and a new host's prompt has three (the fingerprint, the question):
rem the client reads the whole prompt from the line cmd was started with, which delayed expansion copies untouched.
setlocal EnableDelayedExpansion
set "LEVIATHAN_ASKPASS_CMDLINE=!CMDCMDLINE!"
rem Off again, so a "!" in the prompt reaches the client as it is.
setlocal DisableDelayedExpansion
set ELECTRON_RUN_AS_NODE=1
"%LEVIATHAN_ASKPASS_NODE%" "%LEVIATHAN_ASKPASS_MAIN%" %*
