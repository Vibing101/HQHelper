export function docToJson(doc: any): any {
  const obj = doc.toObject ? doc.toObject({ virtuals: false }) : { ...doc };
  obj.id = obj._id?.toString() ?? obj.id;
  delete obj._id;
  delete obj.__v;
  return obj;
}
