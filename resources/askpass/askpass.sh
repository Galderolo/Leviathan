#!/bin/sh
# Invoked by git (GIT_ASKPASS) and ssh (SSH_ASKPASS) with the prompt as argument.
# Forwards it to the running Leviathan window and prints the answer.
ELECTRON_RUN_AS_NODE=1 exec "$LEVIATHAN_ASKPASS_NODE" "$LEVIATHAN_ASKPASS_MAIN" "$@"
