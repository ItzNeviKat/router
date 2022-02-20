import React, { Children, FC, isValidElement } from 'react';
import {
  View as VKUIView,
  ViewProps,
  Root as VKUIRoot,
  RootProps,
  Epic as VKUIEpic,
  EpicProps,
  ModalRoot as VKUIModalRoot,
  ModalRootProps
} from '@vkontakte/vkui';
import { NavIdProps } from '@vkontakte/vkui/dist/lib/getNavId';

import { useParams } from './hooks';
import { back } from './router';
import { getNavID } from './utils/node';

// nav or id prop required
type NavIdRequiredProps = Required<
  Pick<NavIdProps, 'nav'> | Pick<NavIdProps, 'id'>
>;

export const View: FC<
  Omit<ViewProps, 'activePanel' | 'history' | 'onSwipeback'> &
    NavIdRequiredProps
> = (props) => (
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  <VKUIView {...props}>{props.children}</VKUIView>
);

export const Root: FC<Omit<RootProps, 'activeView'> & NavIdRequiredProps> = (
  props
) => (
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  <VKUIRoot {...props}>{props.children}</VKUIRoot>
);

export const Epic: FC<Omit<EpicProps, 'activeStory'> & NavIdRequiredProps> = (
  props
) => (
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  <VKUIEpic {...props}>{props.children}</VKUIEpic>
);

// modals
export const ModalRoot: FC<ModalRootProps> = (props) => {
  let { modal = null } = useParams();

  return (
    <VKUIModalRoot activeModal={modal} onClose={back} {...props}>
      {props.children}
    </VKUIModalRoot>
  );
};

// popouts
export const PopoutRoot: FC = ({ children }) => {
  let { popout = null } = useParams();

  return (
    <>
      {popout &&
        Children.toArray(children).find(
          (node) => isValidElement(node) && getNavID(node) === popout
        )}
    </>
  );
};
