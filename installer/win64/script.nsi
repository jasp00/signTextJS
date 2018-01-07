!include "MUI.nsh"

!insertmacro MUI_PAGE_DIRECTORY

Page instfiles "" "" InstfilesLeave
Function InstfilesLeave
 SetRegView 64
 MessageBox MB_YESNO "Do you want to set global visibility?" IDYES global
 WriteRegStr HKCU "SOFTWARE\Mozilla\NativeMessagingHosts\signtextjs_plus" \
  "" "$INSTDIR\signtextjs_plus.json"
 Return
global:
 WriteRegStr HKLM "SOFTWARE\Mozilla\NativeMessagingHosts\signtextjs_plus" \
  "" "$INSTDIR\signtextjs_plus.json"
FunctionEnd

!insertmacro MUI_LANGUAGE "English"

Name "signTextJS plus"
InstallDir "$PROGRAMFILES64\signtextjs_plus"
ShowInstDetails show

Section "signTextJS plus"
 SetOutPath $INSTDIR
 File /r installer.root\*
SectionEnd
