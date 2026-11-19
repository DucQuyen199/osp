# Logistics route assignment

Routes keep their existing `stops` JSON field. A route can be assigned to a shipment with an optional `route_stop_number`; the number is one-based and selects one entry from the route's `stops` array. Stops may be non-empty strings or non-empty objects. For object stops, the delivery board displays `name`, `address`, `label`, or `location` when available, and otherwise shows the stop data.

The route and stop are optional while a shipment is being prepared, so existing routes and shipments remain valid. If a route is assigned, dispatch requires a valid stop. The API verifies that the route belongs to the current tenant and that the selected stop exists. Once a shipment references a route, its stop list cannot be reordered or changed and the route cannot be deleted; this preserves the meaning of the stored stop number for shipment history. A route assignment cannot be changed after dispatch.

Legacy route records are not migrated or rewritten. A legacy route can be assigned when its existing `stops` value is an array containing the selected non-empty string or object.
