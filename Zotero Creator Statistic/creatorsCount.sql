CREATE VIEW "main"."creatorsCount" AS
SELECT 
	creatorID ,
	count(itemID) AS "itemCount" 
FROM "itemCreators"
GROUP BY itemCreators.creatorID;