; Карточка 046, слово владельца (UD-54): один exe — и portable, и «типа-установка».
; Первый запуск кладёт программу в постоянное место (не во временную папку) и стартует её оттуда; следующие
; запуски мгновенны. Запущенный файл новее установленного — обновляет; старее — просто запускает установленное.
; Окно принадлежит постоянному exe, поэтому закрепление в панели задач переживает выход.
; Сборка: desktop/build.mjs (передаёт /D…: VERSION, VER_MAJOR…VER_PATCH, OUT, PAYLOAD, ICON, APP_ID, PUBLISHER).

Unicode true
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Name "viboard"
Icon "${ICON}"
UninstallIcon "${ICON}"
OutFile "${OUT}"
; постоянное место — та же папка, что была у прежнего отдельного установщика
InstallDir "$LOCALAPPDATA\Programs\viboard-desktop"
InstallDirRegKey HKCU "Software\viboard" "InstallDir"
; только для проверки сборки: /DTEST_INSTDIR=<папка> ставит не в профиль пользователя
!ifdef TEST_INSTDIR
  InstallDir "${TEST_INSTDIR}"
!endif
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
CRCCheck on
SetCompressor /SOLID lzma

!define APP_EXE "viboard-desktop.exe"
!define UNINST "Uninstall viboard.exe"
!define REG_UNINSTALL_ROOT "Software\Microsoft\Windows\CurrentVersion\Uninstall"
!define REG_UNINST "${REG_UNINSTALL_ROOT}\viboard"

Section
  ; нужно ли ставить или обновлять: установленная версия ниже версии этого файла
  ; (по частям, слева направо: IntOp в NSIS 32-битный, а 64-битной арифметики версия не требует)
  StrCpy $R6 1
  ${If} ${FileExists} "$INSTDIR\${APP_EXE}"
    ; GetDllVersion: старшее слово — major и minor, младшее — build и patch
    ClearErrors
    GetDllVersion "$INSTDIR\${APP_EXE}" $R0 $R1
    ${IfNot} ${Errors}
      IntOp $R8 $R0 >> 16
      IntOp $R9 $R0 & 0xFFFF
      IntOp $R7 $R1 >> 16
      IntOp $R5 $R1 & 0xFFFF
      ${If} $R8 U< ${VER_MAJOR}
        StrCpy $R6 1
      ${ElseIf} $R8 U> ${VER_MAJOR}
        StrCpy $R6 0
      ${ElseIf} $R9 U< ${VER_MINOR}
        StrCpy $R6 1
      ${ElseIf} $R9 U> ${VER_MINOR}
        StrCpy $R6 0
      ${ElseIf} $R7 U< ${VER_BUILD}
        StrCpy $R6 1
      ${ElseIf} $R7 U> ${VER_BUILD}
        StrCpy $R6 0
      ${ElseIf} $R5 U< ${VER_PATCH}
        StrCpy $R6 1
      ${Else}
        StrCpy $R6 0
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ${If} $R6 == 1
    ; программа запущена из папки установки — её файлы заняты; обновим в следующий раз, когда она закрыта.
    ; Запущенная программа держит свой exe: открыть его на запись нельзя (INVALID_HANDLE_VALUE = -1).
    ${If} ${FileExists} "$INSTDIR\${APP_EXE}"
      System::Call 'kernel32::CreateFileW(w "$INSTDIR\${APP_EXE}", i 0x40000000, i 0, i 0, i 3, i 0, i 0) i.R7'
      ${If} $R7 == -1
        StrCpy $R6 0
      ${EndIf}
      System::Call 'kernel32::CloseHandle(i R7)'
    ${EndIf}
  ${EndIf}

  ${If} $R6 == 1
    RMDir /r "$INSTDIR"
    SetOutPath "$INSTDIR"
    File /r "${PAYLOAD}\*.*"
    WriteUninstaller "$INSTDIR\${UNINST}"
    WriteRegStr HKCU "Software\viboard" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "${REG_UNINST}" "DisplayName" "viboard"
    WriteRegStr HKCU "${REG_UNINST}" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "${REG_UNINST}" "Publisher" "${PUBLISHER}"
    WriteRegStr HKCU "${REG_UNINST}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
    WriteRegStr HKCU "${REG_UNINST}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "${REG_UNINST}" "UninstallString" '$\"$INSTDIR\${UNINST}$\"'
    WriteRegDWORD HKCU "${REG_UNINST}" "NoModify" 1
    WriteRegDWORD HKCU "${REG_UNINST}" "NoRepair" 1
    ; ярлык в меню «Пуск»: программу, лежащую постоянно, должно быть можно найти и удалить из системы
    CreateShortcut "$SMPROGRAMS\viboard.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
    WinShell::SetLnkAUMI "$SMPROGRAMS\viboard.lnk" "${APP_ID}"
  ${EndIf}

  ; аргументы передаются как есть
  ${GetParameters} $R9
  Exec '$\"$INSTDIR\${APP_EXE}$\" $R9'
SectionEnd

Section "Uninstall"
  nsExec::Exec 'cmd /c taskkill /F /IM ${APP_EXE}'
  Sleep 700
  Delete "$SMPROGRAMS\viboard.lnk"
  DeleteRegKey HKCU "${REG_UNINST}"
  DeleteRegValue HKCU "Software\viboard" "InstallDir"
  DeleteRegKey /ifempty HKCU "Software\viboard"
  RMDir /r "$INSTDIR"
SectionEnd
