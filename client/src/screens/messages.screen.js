import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import PropTypes from 'prop-types';
import React, { Component } from 'react';
import randomColor from 'randomcolor';
import { graphql, compose } from 'react-apollo';
import update from 'immutability-helper';
import _ from 'lodash';
import moment from 'moment';
import { connect } from 'react-redux';
import gql from 'graphql-tag';

import { wsClient } from '../app';
import Message from '../components/message.component';
import MessageInput from '../components/message-input.component';
import GROUP_QUERY from '../graphql/group.query';
import CREATE_MESSAGE_MUTATION from '../graphql/create-message.mutation';
import USER_QUERY from '../graphql/user.query';
import MESSAGE_ADDED_SUBSCRIPTION from '../graphql/message-added.subscription';
import UPDATE_GROUP_MUTATION from '../graphql/update-group.mutation';

const styles = StyleSheet.create({
  container: {
    alignItems: 'stretch',
    backgroundColor: '#e5ddd5',
    flex: 1,
    flexDirection: 'column',
  },
  loading: {
    justifyContent: 'center',
  },
  titleWrapper: {
    alignItems: 'center',
    position: 'absolute',
    left: 0,
    right: 0,
  },
  title: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleImage: {
    marginRight: 6,
    width: 32,
    height: 32,
    borderRadius: 16,
  },
});

class Messages extends Component {
  static navigationOptions = ({ navigation }) => {
    const { state, navigate } = navigation;

    const goToGroupDetails = navigate.bind(this, 'GroupDetails', {
      id: state.params.groupId,
      title: state.params.title,
    });

    return {
      headerTitle: (
        <TouchableOpacity
          style={styles.titleWrapper}
          onPress={goToGroupDetails}
        >
          <View style={styles.title}>
            <Image
              style={styles.titleImage}
              source={{ uri: state.params.icon || 'https://facebook.github.io/react/img/logo_og.png' }}
            />
            <Text>{state.params.title}</Text>
          </View>
        </TouchableOpacity>
      ),
    };
  };

  constructor(props) {
    super(props);
    const usernameColors = {};
    if (props.group && props.group.users) {
      props.group.users.forEach((user) => {
        usernameColors[user.username] = randomColor();
      });
    }

    this.state = {
      usernameColors,
    };

    this.renderItem = this.renderItem.bind(this);
    this.send = this.send.bind(this);
    this.onEndReached = this.onEndReached.bind(this);
  }

  componentWillReceiveProps(nextProps) {
    const usernameColors = {};
    // check for new messages
    if (nextProps.group) {
      if (!this.props.group &&
        (this.props.navigation.state.params.icon !== nextProps.group.icon)) {
        this.refreshNavigation(nextProps);
      }

      if (nextProps.group.messages && nextProps.group.messages.length && nextProps.group.messages[0].id >= 0 &&
        (!nextProps.group.lastRead || nextProps.group.lastRead.id !== nextProps.group.messages[0].id)) {
        const { group } = nextProps;
        nextProps.updateGroup({ id: group.id, name: group.name, lastRead: group.messages[0].id });
      }

      if (nextProps.group.users) {
        // apply a color to each user
        nextProps.group.users.forEach((user) => {
          usernameColors[user.username] = this.state.usernameColors[user.username] || randomColor();
        });
      }

      // we don't resubscribe on changed props
      // because it never happens in our app
      if (!this.subscription) {
        this.subscription = nextProps.subscribeToMore({
          document: MESSAGE_ADDED_SUBSCRIPTION,
          variables: { groupIds: [nextProps.navigation.state.params.groupId] },
          updateQuery: (previousResult, { subscriptionData }) => {
            const newMessage = subscriptionData.data.messageAdded;

            return update(previousResult, {
              group: {
                messages: {
                  $unshift: [newMessage],
                },
              },
            });
          },
        });
      }

      if (!this.reconnected) {
        this.reconnected = wsClient.onReconnected(() => {
          this.props.refetch(); // check for any data lost during disconnect
        }, this);
      }

      this.setState({
        usernameColors,
      });
    } else if (this.reconnected) {
      // remove event subscription
      this.reconnected();
    }
  }

  onEndReached() {
    if (!this.state.loadingMoreEntries) {
      this.setState({
        loadingMoreEntries: true,
      });
      this.props.loadMoreEntries().then(() => {
        this.setState({
          loadingMoreEntries: false,
        });
      });
    }
  }

  send(text) {
    this.props.createMessage({
      groupId: this.props.navigation.state.params.groupId,
      text,
    }).then(() => {
      this.flatList.scrollToIndex({ index: 0, animated: true });
    });
  }

  keyExtractor = item => item.id;

  refreshNavigation(props) {
    const { navigation, group } = props;
    navigation.setParams({
      icon: group.icon,
    });
  }

  renderItem = ({ item: message }) => (
    <Message
      color={this.state.usernameColors[message.from.username]}
      isCurrentUser={message.from.id === this.props.auth.id}
      message={message}
    />
  )

  render() {
    const { loading, group } = this.props;

    // render loading placeholder while we fetch messages
    if (loading || !group) {
      return (
        <View style={[styles.loading, styles.container]}>
          <ActivityIndicator />
        </View>
      );
    }

    // render list of messages for group
    return (
      <KeyboardAvoidingView
        behavior={'position'}
        contentContainerStyle={styles.container}
        keyboardVerticalOffset={64}
        style={styles.container}
      >
        <FlatList
          ref={(ref) => { this.flatList = ref; }}
          inverted
          data={group.messages}
          keyExtractor={this.keyExtractor}
          renderItem={this.renderItem}
          ListEmptyComponent={<View />}
          onEndReached={this.onEndReached}
        />
        <MessageInput send={this.send} />
      </KeyboardAvoidingView>
    );
  }
}

Messages.propTypes = {
  auth: PropTypes.shape({
    id: PropTypes.number,
    username: PropTypes.string,
  }),
  createMessage: PropTypes.func,
  navigation: PropTypes.shape({
    navigate: PropTypes.func,
    state: PropTypes.shape({
      params: PropTypes.shape({
        groupId: PropTypes.number,
        icon: PropTypes.string,
      }),
    }),
  }),
  group: PropTypes.shape({
    icon: PropTypes.string,
    lastRead: PropTypes.shape({
      id: PropTypes.number,
    }),
    messages: PropTypes.array,
    users: PropTypes.array,
  }),
  loading: PropTypes.bool,
  loadMoreEntries: PropTypes.func,
  refetch: PropTypes.func,
  subscribeToMore: PropTypes.func,
  updateGroup: PropTypes.func,
};

const ITEMS_PER_PAGE = 10;
const groupQuery = graphql(GROUP_QUERY, {
  options: ownProps => ({
    variables: {
      groupId: ownProps.navigation.state.params.groupId,
      offset: 0,
      limit: ITEMS_PER_PAGE,
    },
  }),
  props: ({ data: { fetchMore, loading, group, refetch, subscribeToMore } }) => ({
    loading,
    group,
    refetch,
    subscribeToMore,
    loadMoreEntries() {
      return fetchMore({
        // query: ... (you can specify a different query.
        // GROUP_QUERY is used by default)
        variables: {
          // We are able to figure out offset because it matches
          // the current messages length
          offset: group.messages.length,
        },
        updateQuery: (previousResult, { fetchMoreResult }) => {
          // we will make an extra call to check if no more entries
          if (!fetchMoreResult) { return previousResult; }
          // push results (older messages) to end of messages list
          return update(previousResult, {
            group: {
              messages: { $push: fetchMoreResult.group.messages },
            },
          });
        },
      });
    },
  }),
});

const createMessageMutation = graphql(CREATE_MESSAGE_MUTATION, {
  props: ({ ownProps, mutate }) => ({
    createMessage: message =>
      mutate({
        variables: { message },
        optimisticResponse: {
          __typename: 'Mutation',
          createMessage: {
            __typename: 'Message',
            id: -1, // don't know id yet, but it doesn't matter
            text: message.text, // we know what the text will be
            createdAt: new Date().toISOString(), // the time is now!
            from: {
              __typename: 'User',
              id: ownProps.auth.id,
              username: ownProps.auth.username,
            },
            to: {
              __typename: 'Group',
              id: message.groupId,
            },
          },
        },
        update: (store, { data: { createMessage } }) => {
          // Read the data from our cache for this query.
          const groupData = store.readQuery({
            query: GROUP_QUERY,
            variables: {
              groupId: message.groupId,
              offset: 0,
              limit: ITEMS_PER_PAGE,
            },
          });

          // Add our message from the mutation to the end.
          groupData.group.messages.unshift(createMessage);

          // Write our data back to the cache.
          store.writeQuery({
            query: GROUP_QUERY,
            variables: {
              groupId: message.groupId,
              offset: 0,
              limit: ITEMS_PER_PAGE,
            },
            data: groupData,
          });

          const userData = store.readQuery({
            query: USER_QUERY,
            variables: {
              id: ownProps.auth.id,
            },
          });

          // check whether the mutation is the latest message and update cache
          const updatedGroup = _.find(userData.user.groups, { id: message.groupId });
          if (!updatedGroup.messages.length ||
            moment(updatedGroup.messages[0].createdAt).isBefore(moment(message.createdAt))) {
            // update the latest message
            updatedGroup.messages[0] = createMessage;

            // Write our data back to the cache.
            store.writeQuery({
              query: USER_QUERY,
              variables: {
                id: ownProps.auth.id,
              },
              data: userData,
            });
          }
        },
      }),

  }),
});

const updateGroupMutation = graphql(UPDATE_GROUP_MUTATION, {
  props: ({ mutate }) => ({
    updateGroup: group =>
      mutate({
        variables: { group },
        update: (store, { data: { updateGroup } }) => {
          // Read the data from our cache for this query.
          store.writeFragment({
            id: `Group:${updateGroup.id}`,
            fragment: gql`
              fragment group on Group {
                unreadCount
              }
            `,
            data: {
              __typename: 'Group',
              unreadCount: 0,
            },
          });
        },
      }),
  }),
});

const mapStateToProps = ({ auth }) => ({
  auth,
});

export default compose(
  connect(mapStateToProps),
  groupQuery,
  createMessageMutation,
  updateGroupMutation,
)(Messages);
