# Custom NSIS script for 忆尘记账 / yichen-ledger.
#
# electron-builder includes this file automatically (buildResources/installer.nsh).
#
# Why this exists
# ---------------
# Before installing a new version, the generated installer runs the uninstaller of
# the previously installed version (see `uninstallOldVersion` in
# app-builder-lib/templates/nsis/include/installUtil.nsh). It reads `UninstallString`
# and `InstallLocation` from the registry, copies the old uninstaller into
# $PLUGINSDIR and waits for it.
#
# If the old installation folder was deleted or moved by hand (or the uninstall
# entry is a leftover), that step fails and the stock behaviour is:
#
#   MessageBox "Failed to uninstall old application files. Please try running the
#               installer again.: 2"
#   SetErrorLevel 2
#   Quit
#
# i.e. the user is permanently locked out of installing any newer build until the
# registry key is cleaned manually. That is a terrible failure mode for an app that
# is installed per-user under %LOCALAPPDATA%\Programs.
#
# Fix: override the result check. A dirty uninstall is logged and ignored, the new
# version is installed on top and rewrites the registry entries and shortcuts. In
# the worst case an orphaned folder is left behind, which the user can delete.
#
# Keeping the file ASCII-only on purpose: NSIS reads includes as UTF-8 only when a
# BOM is present, and this script carries no user-visible text anymore.

!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint `Old uninstaller exited with $R0. Cleaning up was not complete; continuing with the fresh install.`
  ${endif}
!macroend

!macro customUnInstallCheckCurrentUser
  ${if} $R0 != 0
    DetailPrint `Old per-user uninstaller exited with $R0. Continuing with the fresh install.`
  ${endif}
!macroend
