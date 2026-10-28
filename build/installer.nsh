; Per-user Explorer integration. Test builds can override the isolated Classes root.
!ifndef ANVIL_CLASSES_ROOT
  !define ANVIL_CLASSES_ROOT "Software\Classes"
!endif
!define ANVIL_FOLDER_KEY "${ANVIL_CLASSES_ROOT}\Directory\shell\ElementAnvil"
!define ANVIL_BACKGROUND_KEY "${ANVIL_CLASSES_ROOT}\Directory\Background\shell\ElementAnvil"

!macro customInstall
  WriteRegStr HKCU "${ANVIL_FOLDER_KEY}" "" "Открыть в Element Anvil"
  WriteRegStr HKCU "${ANVIL_FOLDER_KEY}" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "${ANVIL_FOLDER_KEY}\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open-folder "%1\."'
  WriteRegStr HKCU "${ANVIL_BACKGROUND_KEY}" "" "Открыть в Element Anvil"
  WriteRegStr HKCU "${ANVIL_BACKGROUND_KEY}" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "${ANVIL_BACKGROUND_KEY}\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open-folder "%V\."'
!macroend

!macro customUnInstall
  Push $R0
  ReadRegStr $R0 HKCU "${ANVIL_FOLDER_KEY}\command" ""
  StrCmp $R0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open-folder "%1\."' 0 +2
  DeleteRegKey HKCU "${ANVIL_FOLDER_KEY}"
  ReadRegStr $R0 HKCU "${ANVIL_BACKGROUND_KEY}\command" ""
  StrCmp $R0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open-folder "%V\."' 0 +2
  DeleteRegKey HKCU "${ANVIL_BACKGROUND_KEY}"
  Pop $R0
!macroend
