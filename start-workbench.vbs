Set ws = CreateObject("WScript.Shell")
' 静默拉起看门狗（看门狗再拉起并守护工作台服务），窗口完全隐藏
ws.Run "cmd /c """"C:\Users\User\.workbuddy\binaries\node\versions\22.22.2\node.exe"" ""F:\yikuaborder-deploy\watchdog.js"" > ""F:\yikuaborder-deploy\watchdog.out.log"" 2>&1""", 0, False
