#!/bin/bash

function geit_test(){
  local mytmpdir=`mktemp -d 2>/dev/null || mktemp -d -t 'geit-test'`
  mkdir -p $mytmpdir

  git clone --quiet --depth 1 "$@" $mytmpdir/git >/dev/null 2>&1 &
  node ./geit-clone.js "$@" $mytmpdir/geit &
  wait

  rm -rf $mytmpdir/geit/.git
  mv $mytmpdir/git/.git $mytmpdir/geit

  (cd $mytmpdir/geit && git add -N --all && git diff --exit-code)
  local result=$?

  if [ $result -ne 0 ]; then
    printf "\033[0;31m >>> NG >>> \033[0m%s\n" "$*"
  else
    printf "\033[0;32m >>> OK >>> \033[0m%s\n" "$*"
  fi

  rm -rf $mytmpdir
  exit $result
}

export -f geit_test

xargs -P10 -I % bash -c "geit_test %"
result=$?

if [ $result -ne 0 ]; then
  printf "\n\033[0;31m********************** FAILED **********************\033[0m\n"
else
  printf "\n\033[0;32m********************** PASSED **********************\033[0m\n"
fi

exit $result
