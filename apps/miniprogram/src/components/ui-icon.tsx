import { Image } from '@tarojs/components';
import go from '../assets/ui/go.png'; import spark from '../assets/ui/spark.png'; import inbox from '../assets/ui/inbox.png'; import user from '../assets/ui/user.png';
import friends from '../assets/ui/friends.png'; import location from '../assets/ui/location.png'; import down from '../assets/ui/down.png';
import right from '../assets/ui/right.png'; import arrow from '../assets/ui/arrow.png'; import plus from '../assets/ui/plus.png'; import plusWhite from '../assets/ui/plus-white.png';
import heart from '../assets/ui/heart.png'; import settings from '../assets/ui/settings.png'; import close from '../assets/ui/close.png'; import clock from '../assets/ui/clock.png';
import refresh from '../assets/ui/refresh.png'; import search from '../assets/ui/search.png';
import './ui-icon.css';
const icons={go,spark,inbox,user,friends,location,down,right,arrow,plus,plusWhite,heart,settings,close,clock,refresh,search};
export function UiIcon({name,className=''}:{name:keyof typeof icons;className?:string}) { return <Image className={`wv-icon ${className}`} src={icons[name]} mode="aspectFit" ariaHidden/>; }
