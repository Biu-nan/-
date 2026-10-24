Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = "F:\yikuaborder-deploy"
node = "F:\软件\node.exe"
If Not fs.FileExists(node) Then node = "node"
shell.Run "cmd /d /c " & node & " " & root & "\watchdog.js >> " & root & "\watchdog.out.log 2>&1", 0, False
