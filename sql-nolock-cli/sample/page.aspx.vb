Partial Class _Default
    Inherits System.Web.UI.Page

    Protected Sub Page_Load(ByVal sender As Object, ByVal e As System.EventArgs) Handles Me.Load
        Dim sql1 As String = "SELECT a.Id, b.Name FROM dbo.Users a JOIN dbo.Roles b ON b.Id = a.RoleId WHERE a.Active = 1"
        Dim sql2 As String = "SELECT * FROM dbo.Products WITH (INDEX(IX_Products)) WHERE Price > 10"
        Dim sql3 As String = "SELECT * FROM dbo.GetRecentUsers(@days)"
        Dim sql4 As String = "SELECT * FROM (SELECT * FROM dbo.InnerTable) t JOIN schemaX.TableZ z ON z.k = t.k"
        Dim sql5 As String = "Texto qualquer sem SELECT"
        Dim sql6 As String = "SELECT ""aspas"" FROM dbo.Tab"
    End Sub
End Class
