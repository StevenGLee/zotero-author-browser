CREATE VIEW "main"."creatorsCombinationResult" AS 
SELECT 
	creators.creatorID AS "creatorIDfrom",
	CASE WHEN creators.creatorID 
				IN (SELECT creatorIDfrom FROM creatorCombination) 
				THEN (SELECT creatorsCombination.creatorIDto 
							FROM creatorsCombination
							WHERE creatorsCombination.creatorIDfrom = creators.creatorID)
				ELSE creators.creatorID
	END AS "creatorIDto"
FROM creators;