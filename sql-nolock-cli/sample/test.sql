-- comentário
SELECT a.Id, b.Name
FROM dbo.Users a
JOIN dbo.Roles b ON b.Id = a.RoleId
WHERE a.Active = 1;

-- já tem WITH
SELECT *
FROM dbo.Products WITH (INDEX(IX_Products), PAD_INDEX = OFF)
WHERE Price > 10;

-- função table-valued não deve alterar
SELECT * FROM dbo.GetRecentUsers(@days);

-- derived table não deve alterar
SELECT *
FROM (
  SELECT * FROM dbo.InnerTable
) t
JOIN schemaX.TableZ z ON z.k = t.k;
