CREATE VIEW "main"."creatorsCountCombination" AS
SELECT
	creatorsCombinationResult.creatorIDto AS "creatorID",
	creators.firstName AS "firstName", 
	creators.lastName AS "lastName", 
	sum(creatorsCount.itemCount) AS "creatorTotal"
FROM creatorsCombinationResult 
JOIN creatorsCount ON creatorsCount.creatorID = creatorsCombinationResult.creatorIDfrom
JOIN creators ON creatorsCombinationResult.creatorIDto = creators.creatorID
GROUP BY creatorsCombinationResult.creatorIDto
ORDER BY "creatorTotal" DESC;