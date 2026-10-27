import { venueSelectionSchema, type RequirementLocation } from '@weevibe/contracts';
/** A manual label edit invalidates every previously sourced coordinate/address. */
export function editRequirementLocation(location: RequirementLocation, label: string): RequirementLocation {
  return { id: location.id, label };
}
export function mapRequirementLocation(id: string, candidate: unknown): RequirementLocation {
  const venue=venueSelectionSchema.parse(candidate);
  if(!venue.name.trim()||venue.name.length>200) throw new Error('地图地点名称长度无效');
  return { id, label: venue.name, venue };
}
