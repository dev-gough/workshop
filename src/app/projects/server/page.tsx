import { redirect } from 'next/navigation';

export default function ServerIndex() {
  redirect('/projects/server/services');
}
