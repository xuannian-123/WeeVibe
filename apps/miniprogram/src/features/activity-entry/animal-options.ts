import type { GatheringAnimalId } from '@weevibe/contracts';
import cat from '../../assets/gathering-animals/cat.png';
import dog from '../../assets/gathering-animals/dog.png';
import fox from '../../assets/gathering-animals/fox.png';
import rabbit from '../../assets/gathering-animals/rabbit.png';
import bear from '../../assets/gathering-animals/bear.png';
import panda from '../../assets/gathering-animals/panda.png';
import koala from '../../assets/gathering-animals/koala.png';
import tiger from '../../assets/gathering-animals/tiger.png';
import lion from '../../assets/gathering-animals/lion.png';
import penguin from '../../assets/gathering-animals/penguin.png';
import owl from '../../assets/gathering-animals/owl.png';
import capybara from '../../assets/gathering-animals/capybara.png';

// Reuse PR41's bundled assets and enum, without writing a formal activity into a gathering.
export const invitationAnimals: ReadonlyArray<{ id: GatheringAnimalId; name: string; image: string }> = [
  { id: 'cat', name: '小猫', image: cat }, { id: 'dog', name: '小狗', image: dog },
  { id: 'fox', name: '狐狸', image: fox }, { id: 'rabbit', name: '兔子', image: rabbit },
  { id: 'bear', name: '小熊', image: bear }, { id: 'panda', name: '熊猫', image: panda },
  { id: 'koala', name: '考拉', image: koala }, { id: 'tiger', name: '老虎', image: tiger },
  { id: 'lion', name: '狮子', image: lion }, { id: 'penguin', name: '企鹅', image: penguin },
  { id: 'owl', name: '猫头鹰', image: owl }, { id: 'capybara', name: '水豚', image: capybara },
];

/** A random preview always changes an existing selection; this is not identity allocation. */
export function randomInvitationAnimal(current?: GatheringAnimalId, random = Math.random): GatheringAnimalId {
  const choices = invitationAnimals.filter(animal => animal.id !== current);
  const sample = random();
  const index = Number.isFinite(sample) ? Math.min(choices.length - 1, Math.max(0, Math.floor(sample * choices.length))) : 0;
  return choices[index].id;
}
